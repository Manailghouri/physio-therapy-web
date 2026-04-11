/**
 * Real-Time Feedback Generator
 *
 * Stateful engine that runs every frame inside the comparison-recorder render loop.
 * Emits short, helpful phrases to the console with built-in cooldowns so the
 * patient isn't spammed.
 *
 * Progression-aware:
 *   allowProgression = true  → encourage more ROM ("try to go higher")
 *   allowProgression = false → warn about exceeding reference ("ease back a little")
 */

import type { LearnedExerciseTemplate } from "./exercise-state-learner"
import type { RepError } from "./rep-error-calculator"

// Types

export type FeedbackSeverity = "success" | "info" | "warning"

export interface FeedbackMessage {
  severity: FeedbackSeverity
  message: string
}

// Readable angle labels

const ANGLE_LABELS: Record<string, string> = {
  left_knee: "left knee",
  right_knee: "right knee",
  left_shoulder: "left shoulder",
  right_shoulder: "right shoulder",
  left_elbow: "left elbow",
  right_elbow: "right elbow",
  left_hip: "left hip",
  right_hip: "right hip",
  left_leg_segment: "lower left leg",
  right_leg_segment: "lower right leg",
  left_thigh_segment: "left thigh",
  right_thigh_segment: "right thigh",
  left_arm_segment: "left upper arm",
  right_arm_segment: "right upper arm",
  left_forearm_segment: "left forearm",
  right_forearm_segment: "right forearm",
}

function readable(angleName: string): string {
  return ANGLE_LABELS[angleName] ?? angleName.replace(/_/g, " ")
}

//  Exercise-specific short phrases

interface ExercisePhrases {
  extendMore: string
  goFurther: string
  tooFar: string
  holdSteady: string
  almostThere: string
  niceHold: string
}

const EXERCISE_PHRASES: Record<string, ExercisePhrases> = {
  "knee-extension": {
    extendMore: "Straighten your knee more",
    goFurther: "Try to extend further",
    tooFar: "Ease back, you're extending too much",
    holdSteady: "Keep your thigh steady",
    almostThere: "Almost there, push a little more",
    niceHold: "Good hold!",
  },
  "scap-wall-slides": {
    extendMore: "Raise your arms higher",
    goFurther: "Try to reach higher up the wall",
    tooFar: "You're going too high, keep it controlled",
    holdSteady: "Keep your elbows bent",
    almostThere: "Almost there, slide up a bit more",
    niceHold: "Nice, hold that position",
  },
}

const DEFAULT_PHRASES: ExercisePhrases = {
  extendMore: "Increase your range of motion",
  goFurther: "Try to push a little further",
  tooFar: "Ease back a little",
  holdSteady: "Keep steady",
  almostThere: "Almost there!",
  niceHold: "Good hold!",
}

// Motivational lines (rotated so they don't repeat)

const MOTIVATION = [
  "Keep it up!",
  "You're doing great!",
  "Nice work!",
  "Solid rep!",
  "That's the way!",
  "Looking good!",
  "Strong!",
  "Great effort!",
]

const STREAK_MOTIVATION = [
  "You're on a roll!",
  "Consistency is key, and you've got it!",
  "Three in a row, nice!",
  "Keep this streak going!",
]

// Stateful engine

export class RealtimeFeedbackEngine {
  // Config (set once)
  private exerciseType: string
  private allowProgression: boolean
  private referenceTemplate: LearnedExerciseTemplate
  private idealTemplate: LearnedExerciseTemplate | null
  private anglesOfInterest: string[]

  // Derived (computed once from templates)
  private primaryAngle: string
  private refPeak: number
  private refStart: number
  private idealPeak: number

  // Cooldowns — keyed by category, stores last-emit timestamp (seconds)
  private lastEmitTime: Record<string, number> = {}
  private readonly COOLDOWN_S = 4 // min seconds between same-category messages

  // State tracking
  private lastPhase: "rest" | "active" = "rest"
  private consecutiveGoodReps = 0
  private totalRepsLogged = 0
  private motivationIdx = 0
  private streakIdx = 0
  private lastFormScore = 100
  private formWasLow = false
  private repPeakReached = 0

  constructor(opts: {
    exerciseType: string
    allowProgression: boolean
    referenceTemplate: LearnedExerciseTemplate
    idealTemplate: LearnedExerciseTemplate | null
    anglesOfInterest: string[]
  }) {
    this.exerciseType = opts.exerciseType
    this.allowProgression = opts.allowProgression
    this.referenceTemplate = opts.referenceTemplate
    this.idealTemplate = opts.idealTemplate
    this.anglesOfInterest = opts.anglesOfInterest
    this.primaryAngle = opts.anglesOfInterest[0] ?? ""

    // Pre-compute reference/ideal peaks
    this.refPeak = 0
    this.refStart = Infinity
    for (const s of this.referenceTemplate.states) {
      const r = s.angleRanges[this.primaryAngle]
      if (r) {
        if (r.mean > this.refPeak) this.refPeak = r.mean
        if (r.mean < this.refStart) this.refStart = r.mean
      }
    }

    const effective = opts.allowProgression && opts.idealTemplate
      ? opts.idealTemplate
      : this.referenceTemplate
    this.idealPeak = 0
    for (const s of effective.states) {
      const r = s.angleRanges[this.primaryAngle]
      if (r && r.mean > this.idealPeak) this.idealPeak = r.mean
    }
  }

  // Call this every frame

  tick(ctx: {
    now: number             // timestamp in seconds
    smoothedAngles: Record<string, number>
    repError: RepError | null
    formScore: number       // 0-100
    repCount: number
    thresholdStatus: "below" | "valid" | "good" | "rest"
  }): void {
    const { now, smoothedAngles, repError, formScore, repCount, thresholdStatus } = ctx
    const phrases = EXERCISE_PHRASES[this.exerciseType] ?? DEFAULT_PHRASES
    const primaryVal = smoothedAngles[this.primaryAngle]

    // Track rep peak within cycle
    if (primaryVal !== undefined && primaryVal > this.repPeakReached) {
      this.repPeakReached = primaryVal
    }

    // Phase transitions
    const midpoint = (this.refStart + this.refPeak) / 2

    if (primaryVal !== undefined && primaryVal < midpoint && this.lastPhase === "active") {
      // Returning to rest → rep cycle complete
      this.onRepComplete(now, formScore, phrases)
      this.repPeakReached = primaryVal ?? 0
      this.lastPhase = "rest"
    } else if (primaryVal !== undefined && primaryVal >= midpoint && this.lastPhase === "rest") {
      this.lastPhase = "active"
    }

    // Active-phase nudges 
    if (this.lastPhase === "active" && primaryVal !== undefined) {
      const TOLERANCE = 0.9

      if (thresholdStatus === "below") {
        // Not reaching reference yet
        const pctToRef = this.refPeak > this.refStart
          ? (primaryVal - this.refStart) / (this.refPeak - this.refStart)
          : 0

        if (pctToRef >= 0.75) {
          this.emit("nudge-almost", now, "info", phrases.almostThere)
        } else {
          this.emit("nudge-extend", now, "warning", phrases.extendMore)
        }
      } else if (thresholdStatus === "valid" && this.allowProgression) {
        // Reached reference but not ideal → encourage more
        this.emit("nudge-further", now, "info", phrases.goFurther)
      } else if (thresholdStatus === "good") {
        // Reached ideal — brief praise
        this.emit("nudge-hold", now, "success", phrases.niceHold)
      }

      // Patient exceeding reference when they shouldn't
      if (!this.allowProgression && primaryVal > this.refPeak * 1.05) {
        this.emit("nudge-toofar", now, "warning", phrases.tooFar)
      }
    }

    // Secondary angle drift
    if (repError && this.lastPhase === "active") {
      const secondaryEntries = Object.entries(repError.errors)
        .filter(([name]) => name !== this.primaryAngle)
        .sort(([, a], [, b]) => b.error - a.error)

      for (const [angleName, err] of secondaryEntries) {
        if (err.error > 15) {
          this.emit(
            `drift-${angleName}`,
            now,
            "warning",
            `Watch your ${readable(angleName)}`,
          )
          break // only nag about the worst one per tick
        }
      }
    }

    // Form score dip alert 
    if (formScore < 40 && this.lastFormScore >= 40) {
      this.emit("form-dip", now, "warning", "Focus on controlled movement")
      this.formWasLow = true
    } else if (formScore >= 70 && this.formWasLow) {
      this.emit("form-recovery", now, "success", "Form looking better!")
      this.formWasLow = false
    }
    this.lastFormScore = formScore
  }

  // Called when a rep cycle completes (active → rest)

  private onRepComplete(now: number, formScore: number, phrases: ExercisePhrases): void {
    this.totalRepsLogged++
    const TOLERANCE = 0.9
    const wasGood = this.repPeakReached >= this.idealPeak * TOLERANCE
    const wasValid = this.repPeakReached >= this.refPeak * TOLERANCE

    if (wasGood) {
      this.consecutiveGoodReps++
    } else if (wasValid) {
      // Valid but not ideal
      this.consecutiveGoodReps = 0
      if (this.allowProgression) {
        this.emit("rep-push", now, "info", "Good rep — try to go a bit further next time")
      }
    } else {
      this.consecutiveGoodReps = 0
    }

    // Streak motivation
    if (this.consecutiveGoodReps >= 3) {
      const line = STREAK_MOTIVATION[this.streakIdx % STREAK_MOTIVATION.length]
      this.emit("streak", now, "success", line)
      this.streakIdx++
    } else if (wasGood || (wasValid && formScore >= 70)) {
      // Single good rep → rotating motivation
      const line = MOTIVATION[this.motivationIdx % MOTIVATION.length]
      this.emit("motivation", now, "success", line)
      this.motivationIdx++
    }

    // Form-specific rep feedback
    if (formScore < 50 && wasValid) {
      this.emit("rep-form", now, "info", "Good range, tighten up your form")
    }

    // Fatigue detection: if last 2+ reps had declining form
    if (this.totalRepsLogged >= 4 && formScore < 50) {
      this.emit("fatigue", now, "info", "Getting tired? Take a breath if you need to")
    }
  }

  // Cooldown-aware emitter 

  private emit(category: string, now: number, severity: FeedbackSeverity, message: string): void {
    const last = this.lastEmitTime[category] ?? 0
    if (now - last < this.COOLDOWN_S) return

    this.lastEmitTime[category] = now

    const icon = severity === "success" ? "✅" : severity === "warning" ? "⚠️" : "💡"
    console.log(`${icon} ${message}`)
  }
}

// Post-session summary (for upload mode)

import type { ComparisonResult } from "./comparison"
import type { SessionScore } from "./progress-scorer"
import { getExerciseConfig } from "./exercise-config"

export function generatePostSessionFeedback(
  comparison: ComparisonResult,
  score: SessionScore,
  exerciseType: string,
  allowProgression: boolean,
): FeedbackMessage[] {
  const msgs: FeedbackMessage[] = []
  const phrases = EXERCISE_PHRASES[exerciseType] ?? DEFAULT_PHRASES
  const config = getExerciseConfig(exerciseType)
  const primaryAngle = config?.anglesOfInterest[0] ?? null

  // 1. Overall similarity
  if (comparison.similarity >= 85) {
    msgs.push({ severity: "success", message: "Great form overall!" })
  } else if (comparison.similarity >= 60) {
    msgs.push({ severity: "info", message: "Decent effort, a few things to adjust" })
  } else {
    msgs.push({ severity: "warning", message: "Needs some work — check the tips below" })
  }

  // 2. Primary angle (progression-aware)
  if (primaryAngle && comparison.details.angleDeviations[primaryAngle] !== undefined) {
    const dev = comparison.details.angleDeviations[primaryAngle]
    const refStates = comparison.details.referenceTemplate.states
    const upStates = comparison.details.uploadedTemplate.states
    const avgRef = meanAngle(refStates, primaryAngle)
    const avgUp = meanAngle(upStates, primaryAngle)
    const patientHigher = avgUp !== null && avgRef !== null && avgUp > avgRef

    if (dev > 8) {
      if (patientHigher) {
        msgs.push({
          severity: allowProgression ? "success" : "warning",
          message: allowProgression ? phrases.goFurther : phrases.tooFar,
        })
      } else {
        msgs.push({ severity: "warning", message: phrases.extendMore })
      }
    }
  }

  // 3. Secondary angle drifts
  const secondaries = Object.entries(comparison.details.angleDeviations)
    .filter(([name]) => name !== primaryAngle)
    .sort(([, a], [, b]) => b - a)

  for (const [angleName, dev] of secondaries) {
    if (dev > 18) {
      msgs.push({ severity: "warning", message: `Watch your ${readable(angleName)} — it's drifting` })
    } else if (dev > 8) {
      msgs.push({ severity: "info", message: `Slight drift in your ${readable(angleName)}` })
    }
  }

  // 4. Form
  if (score.formScore >= 85) {
    msgs.push({ severity: "success", message: "Excellent form!" })
  } else if (score.formScore < 50) {
    msgs.push({ severity: "warning", message: "Focus on controlled movement" })
  }

  // 5. Progress (only when progression on)
  if (allowProgression) {
    if (score.progressScore >= 80) {
      msgs.push({ severity: "success", message: "You're close to ideal range!" })
    } else if (score.progressScore >= 40) {
      msgs.push({ severity: "info", message: "Good progress, keep pushing" })
    } else if (score.progressScore < 20 && score.validReps > 0) {
      msgs.push({ severity: "info", message: "Try to go a bit further each rep" })
    }
  }

  // 6. Per-rep trend
  if (score.perRepDetails.length >= 3) {
    const half = Math.floor(score.perRepDetails.length / 2)
    const first = score.perRepDetails.slice(0, half)
    const second = score.perRepDetails.slice(half)
    const avgFirst = first.reduce((s, r) => s + r.formScore, 0) / first.length
    const avgSecond = second.reduce((s, r) => s + r.formScore, 0) / second.length

    if (avgSecond - avgFirst > 5) {
      msgs.push({ severity: "success", message: "Your form improved as you went — nice!" })
    } else if (avgFirst - avgSecond > 5) {
      msgs.push({ severity: "info", message: "Form dropped toward the end — maybe fatigue" })
    }
  }

  return msgs
}

function meanAngle(
  states: { angleRanges: Record<string, { mean: number }> }[],
  name: string,
): number | null {
  const vals = states.map(s => s.angleRanges[name]?.mean).filter((v): v is number => v !== undefined)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export function logFeedback(msgs: FeedbackMessage[]): void {
  console.log("%c=== Exercise Feedback ===", "font-weight:bold;font-size:14px;")
  for (const m of msgs) {
    const icon = m.severity === "success" ? "✅" : m.severity === "warning" ? "⚠️" : "💡"
    console.log(`${icon} ${m.message}`)
  }
}
