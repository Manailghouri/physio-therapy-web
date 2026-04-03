"use client"

import { useRef, useState, useEffect } from "react"
import { PoseLandmarker, FilesetResolver, DrawingUtils, PoseLandmarkerResult } from "@mediapipe/tasks-vision"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { RepErrorGraph } from "@/components/rep-error-graph"
import { calculateRepError, analyzeRepTrends, getErrorFeedback, type RepError, type RepErrorSummary } from "@/lib/rep-error-calculator"
import { OneEuroFilter } from "@/lib/filters"
import { LearnedExerciseTemplate } from "@/lib/exercise-state-learner"

interface ComparisonRecorderProps {
  onVideoRecorded?: (videoBlob: Blob) => void
  anglesOfInterest?: string[]
  exerciseName?: string
  exerciseType?: string
  enableTestMode?: boolean
  referenceTemplate?: LearnedExerciseTemplate
  idealTemplate?: LearnedExerciseTemplate
  allowProgression?: boolean
} 

const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  // Body landmarks
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
}



interface JointAngleData {
  [key: string]: number
}

export function ComparisonRecorder({ onVideoRecorded, anglesOfInterest, exerciseName, exerciseType, enableTestMode = false, referenceTemplate, idealTemplate, allowProgression = true }: ComparisonRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const poseRef = useRef<PoseLandmarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const learnedTemplateRef = useRef<LearnedExerciseTemplate | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const [currentAngles, setCurrentAngles] = useState<JointAngleData>({})
  const [repCount, setRepCount] = useState(0)
  const [correctRepCount, setCorrectRepCount] = useState(0)
  const [incorrectRepCount, setIncorrectRepCount] = useState(0)
  const [currentState, setCurrentState] = useState<string>("")
  const [templateState, setTemplateState] = useState<string>("")
  const [repErrors, setRepErrors] = useState<RepError[]>([])
  const [errorSummary, setErrorSummary] = useState<RepErrorSummary | null>(null)
  const [repDetails, setRepDetails] = useState<Array<{
    index: number
    startTime: number
    endTime: number
    primaryAngle: string
    minAngle: number
    maxAngle: number
    correct: boolean
  }>>([])
  

  const [formScore, setFormScore] = useState<number>(0)
  const [currentRepError, setCurrentRepError] = useState<RepError | null>(null)
  const [errorFeedback, setErrorFeedback] = useState<string>("")
  const [templateName, setTemplateName] = useState<string>("")
  // Dual-threshold live feedback
  const [liveThresholdStatus, setLiveThresholdStatus] = useState<"below" | "valid" | "good">("below")
  const [livePrimaryAngle, setLivePrimaryAngle] = useState<number | null>(null)
  const [liveValidReps, setLiveValidReps] = useState(0)
  const [liveGoodReps, setLiveGoodReps] = useState(0)
  const [testMode, setTestMode] = useState(false)
  const [testVideoFile, setTestVideoFile] = useState<File | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const angleFiltersRef = useRef<Map<string, OneEuroFilter>>(new Map())
  const angleHistoryRef = useRef<Array<{ timestamp: number; angles: JointAngleData }>>([])
  const primaryAngleHistoryRef = useRef<Array<{ t: number; value: number }>>([])
  const lastStateRef = useRef<string>("")
  const hasVisitedPeakRef = useRef(false)
  const lastExtendedTimestampRef = useRef<number | null>(null)
  const stateChangeTimestampRef = useRef<number>(0)
  const minAngleSeenRef = useRef<number>(Infinity)
  const maxAngleSeenRef = useRef<number>(-Infinity)
  const hasLearnedThresholdsRef = useRef<boolean>(false)
  const templateLastStateRef = useRef<string>("")
  const templateLastChangeTsRef = useRef<number>(0)
  const templateVisitedPeakRef = useRef<boolean>(false)
  const lastRepTimestampRef = useRef<number | null>(null)
  const MIN_EXTENDED_HOLD = 0.2 // seconds to hold extended before a rep can be counted
  const MIN_REP_COOLDOWN = 0.6   // seconds between reps to avoid initial extra and double counts
  // Hysteresis thresholds for robust rep detection on primary angle
  const PRIMARY_UP_THRESHOLD = 140 // consider moving upward (extension) when crossing above
  const PRIMARY_DOWN_THRESHOLD = 100 // consider moving downward (flexion) when crossing below
  const MIN_PEAK_DELTA = 15 // minimum change between valley and peak to count a rep
  const repFSMRef = useRef<{ phase: 'idle' | 'up' | 'down'; lastValley?: number; lastPeak?: number }>({ phase: 'idle' })

  const classifyRepQuality = (cycleHistory: Array<{ timestamp: number; angles: JointAngleData }>, primaryAngleName?: string) => {
    // Simple heuristic: a correct rep must reach full extension and return close to rest
    const name = primaryAngleName || (anglesOfInterest && anglesOfInterest[0]) || "right_knee"
    const values = cycleHistory.map(h => h.angles[name]).filter(v => v !== undefined) as number[]
    if (values.length === 0) return false
    const maxAngle = Math.max(...values)
    const minAngle = Math.min(...values)
    // Default expected ranges; can be tuned per-exercise
    const EXTENDED_MIN = 150
    const REST_MAX = 90
    const isExtendedReached = maxAngle >= EXTENDED_MIN
    const isRestReached = minAngle <= REST_MAX
    return isExtendedReached && isRestReached
  }

  const computeRepMinMax = (
    cycleHistory: Array<{ timestamp: number; angles: JointAngleData }>,
    primaryAngleName?: string
  ): { min: number; max: number; primary: string } | null => {
    const name = primaryAngleName || (anglesOfInterest && anglesOfInterest[0]) || "right_knee"
    const values = cycleHistory.map(h => h.angles[name]).filter(v => v !== undefined) as number[]
    if (values.length === 0) return null
    return { min: Math.min(...values), max: Math.max(...values), primary: name }
  }

  const POSE_CONNECTIONS = [
    { start: 0, end: 1 },
    { start: 1, end: 2 },
    { start: 2, end: 3 },
    { start: 3, end: 7 },
    { start: 0, end: 4 },
    { start: 4, end: 5 },
    { start: 5, end: 6 },
    { start: 6, end: 8 },
    { start: 9, end: 10 },
    { start: 11, end: 12 },
    { start: 11, end: 23 },
    { start: 12, end: 24 },
    { start: 23, end: 24 },
    { start: 11, end: 13 },
    { start: 13, end: 15 },
    { start: 15, end: 17 },
    { start: 15, end: 19 },
    { start: 15, end: 21 },
    { start: 17, end: 19 },
    { start: 12, end: 14 },
    { start: 14, end: 16 },
    { start: 16, end: 18 },
    { start: 16, end: 20 },
    { start: 16, end: 22 },
    { start: 18, end: 20 },
    { start: 23, end: 25 },
    { start: 25, end: 27 },
    { start: 27, end: 29 },
    { start: 27, end: 31 },
    { start: 29, end: 31 },
    { start: 24, end: 26 },
    { start: 26, end: 28 },
    { start: 28, end: 30 },
    { start: 28, end: 32 },
    { start: 30, end: 32 },
  ]


  const calculateAngle = (a: number[], b: number[], c: number[]): number => {
    const radians = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(a[1] - b[1], a[0] - b[0])
    let angle = Math.abs((radians * 180.0) / Math.PI)
    if (angle > 180.0) {
      angle = 360.0 - angle
    }
    return angle
  }

  
  const calculateSegmentAngleFromVertical = (start: number[], end: number[]): number => {
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const radians = Math.atan2(dx, dy)
    const degrees = Math.abs((radians * 180.0) / Math.PI)
    return degrees
  }


  // todo: calculate only relevant angles to save compute time
  const calculateAllAngles = (landmarks: any[]): JointAngleData => {
    const angles: JointAngleData = {}
    const getLandmark = (index: number) => [landmarks[index].x, landmarks[index].y]
    
    try {
      angles.left_elbow = calculateAngle(
        getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
        getLandmark(POSE_LANDMARKS.LEFT_ELBOW),
        getLandmark(POSE_LANDMARKS.LEFT_WRIST)
      )
      
      angles.right_elbow = calculateAngle(
        getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
        getLandmark(POSE_LANDMARKS.RIGHT_ELBOW),
        getLandmark(POSE_LANDMARKS.RIGHT_WRIST)
      )
      
      angles.left_knee = calculateAngle(
        getLandmark(POSE_LANDMARKS.LEFT_HIP),
        getLandmark(POSE_LANDMARKS.LEFT_KNEE),
        getLandmark(POSE_LANDMARKS.LEFT_ANKLE)
      )
      
      angles.right_knee = calculateAngle(
        getLandmark(POSE_LANDMARKS.RIGHT_HIP),
        getLandmark(POSE_LANDMARKS.RIGHT_KNEE),
        getLandmark(POSE_LANDMARKS.RIGHT_ANKLE)
      )
      
      angles.left_hip = calculateAngle(
        getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
        getLandmark(POSE_LANDMARKS.LEFT_HIP),
        getLandmark(POSE_LANDMARKS.LEFT_KNEE)
      )
      
      angles.right_hip = calculateAngle(
        getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
        getLandmark(POSE_LANDMARKS.RIGHT_HIP),
        getLandmark(POSE_LANDMARKS.RIGHT_KNEE)
      )

      angles.left_shoulder = calculateAngle(
        getLandmark(POSE_LANDMARKS.LEFT_ELBOW),
        getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
        getLandmark(POSE_LANDMARKS.LEFT_HIP)
      )
      
      angles.right_shoulder = calculateAngle(
        getLandmark(POSE_LANDMARKS.RIGHT_ELBOW),
        getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
        getLandmark(POSE_LANDMARKS.RIGHT_HIP)
      )
      
      angles.left_leg_segment = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.LEFT_KNEE),
        getLandmark(POSE_LANDMARKS.LEFT_ANKLE)
      )
      
      angles.right_leg_segment = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.RIGHT_KNEE),
        getLandmark(POSE_LANDMARKS.RIGHT_ANKLE)
      )
      
      angles.left_thigh_segment = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.LEFT_HIP),
        getLandmark(POSE_LANDMARKS.LEFT_KNEE)
      )
      
      angles.right_thigh_segment = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.RIGHT_HIP),
        getLandmark(POSE_LANDMARKS.RIGHT_KNEE)
      )

      angles.left_arm_segment = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
        getLandmark(POSE_LANDMARKS.LEFT_ELBOW)
      )
      
      angles.right_arm_segment = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
        getLandmark(POSE_LANDMARKS.RIGHT_ELBOW)
      )
      
      angles.left_forearm_segment = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.LEFT_ELBOW),
        getLandmark(POSE_LANDMARKS.LEFT_WRIST)
      )
      
      angles.right_forearm_segment = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.RIGHT_ELBOW),
        getLandmark(POSE_LANDMARKS.RIGHT_WRIST)
      )
      
      const nose = getLandmark(POSE_LANDMARKS.NOSE)
      const leftEye = getLandmark(POSE_LANDMARKS.LEFT_EYE_OUTER)
      const rightEye = getLandmark(POSE_LANDMARKS.RIGHT_EYE_OUTER)
      
      const leftDist = Math.sqrt(
        Math.pow(nose[0] - leftEye[0], 2) + Math.pow(nose[1] - leftEye[1], 2)
      )
      const rightDist = Math.sqrt(
        Math.pow(nose[0] - rightEye[0], 2) + Math.pow(nose[1] - rightEye[1], 2)
      )
      const ratio = leftDist / rightDist
      angles.head_yaw = Math.atan((ratio - 1) / 0.5) * (180 / Math.PI)
      
      angles.nose_horizontal = (nose[0] * 2 - 1 + 1) * 90
    } catch (e) {
      console.warn("Error calculating some angles:", e)
    }
    
    return angles
  }


  // ROHA TO FUTURE ROHA: THIS IS PROBABLY MAKING THE KNEE ANGLES WEIRD
  // despite the angle moving with the knee there's some stiffness idk
  // the knee angle wouldn't follow the leg properly if that makes sense and this is probably the problem 
  const smoothAngles = (rawAngles: JointAngleData, timestamp: number): JointAngleData => {
    const smoothed: JointAngleData = {}
    
    Object.entries(rawAngles).forEach(([angleName, angleValue]) => {
      if (!angleFiltersRef.current.has(angleName)) {
        angleFiltersRef.current.set(angleName, new OneEuroFilter(1.0, 0.007))
      }
      
      const filter = angleFiltersRef.current.get(angleName)!
      smoothed[angleName] = filter.filter(angleValue, timestamp)
    })
    
    return smoothed
  }


  const determineExerciseState = (angles: JointAngleData): string => {
    // Pick a sensible default primary angle if none provided
    let primaryAngle = anglesOfInterest && anglesOfInterest.length > 0
      ? anglesOfInterest[0]
      : ("right_knee")
    
    // If the chosen angle is missing, try a couple of common fallbacks
    let angle = angles[primaryAngle]
    if (angle === undefined) {
      const fallbacks = ["left_knee", "right_elbow", "left_elbow", "right_hip", "left_hip"]
      const found = fallbacks.find(name => angles[name] !== undefined)
      if (!found) return ""
      primaryAngle = found
      angle = angles[primaryAngle]
    }
    
    // thresholds here are assumed - because it makes it easier to run state detection later on 
    // state detection then knows what to look for
    if (angle < 70) {
      return "flexed"
    } else if (angle > 150) {
      return "extended"
    } else {
      return "transition"
    }
  }

  // Velocity + hysteresis based rep counting independent of coarse state
  const updateRepCount = (state: string) => {
    // Derive primary angle reading
    const primaryName = (anglesOfInterest && anglesOfInterest[0]) || 'right_knee'
    const last = angleHistoryRef.current[angleHistoryRef.current.length - 1]
    const prev = angleHistoryRef.current[angleHistoryRef.current.length - 2]
    if (!last || !prev) {
      lastStateRef.current = state
      return
    }
    const a = last.angles[primaryName]
    const b = prev.angles[primaryName]
    if (a === undefined || b === undefined) {
      lastStateRef.current = state
      return
    }
    const nowTs = last.timestamp
    const vel = a - b

    const fsm = repFSMRef.current
    // Initialize valley at start
    if (fsm.phase === 'idle') {
      fsm.lastValley = a
      fsm.phase = 'down'
    }

    // Upward phase detection (extension)
    if (fsm.phase === 'down') {
      // Start going up when crossing upper threshold or velocity positive
      if (a >= PRIMARY_UP_THRESHOLD && vel > 0) {
        fsm.phase = 'up'
        fsm.lastPeak = a
      }
      // Track valley
      if (fsm.lastValley === undefined || a < fsm.lastValley) fsm.lastValley = a
    } else if (fsm.phase === 'up') {
      // Update peak while ascending
      if (fsm.lastPeak === undefined || a > fsm.lastPeak) fsm.lastPeak = a
      // Transition back down when crossing lower threshold or velocity negative
      if (a <= PRIMARY_DOWN_THRESHOLD && vel < 0) {
        // Decide if a valid rep occurred
        const valley = fsm.lastValley ?? a
        const peak = fsm.lastPeak ?? a
        const delta = peak - valley
        const cooledDown = lastRepTimestampRef.current === null || (nowTs - lastRepTimestampRef.current) >= MIN_REP_COOLDOWN
        if (delta >= MIN_PEAK_DELTA && cooledDown) {
          setRepCount(r => r + 1)
          lastRepTimestampRef.current = nowTs
          // Build cycle window: last 1.5s
          const cycle = angleHistoryRef.current.filter(h => nowTs - h.timestamp <= 1.5)
          const isCorrect = classifyRepQuality(cycle, primaryName)
          const minMax = computeRepMinMax(cycle, primaryName)
          if (isCorrect) setCorrectRepCount(c => c + 1)
          else setIncorrectRepCount(c => c + 1)
          if (minMax) {
            setRepDetails(prev => ([
              ...prev,
              {
                index: prev.length + 1,
                startTime: cycle.length ? cycle[0].timestamp : nowTs - 1.5,
                endTime: nowTs,
                primaryAngle: minMax.primary,
                minAngle: Math.round(minMax.min),
                maxAngle: Math.round(minMax.max),
                correct: isCorrect,
              }
            ]))
          }
        }
        // Reset for next cycle
        fsm.phase = 'down'
        fsm.lastValley = a
        fsm.lastPeak = undefined
      }
    }

    lastStateRef.current = state
  }

  const openWebcam = async () => {
    if (isStreaming || isLoading) return
    setIsLoading(true)
    setTestMode(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
        if (canvasRef.current) {
          canvasRef.current.width = videoRef.current.videoWidth || 640
          canvasRef.current.height = videoRef.current.videoHeight || 480
        }
        await initPose()
        startPoseLoop()
      }
      setIsStreaming(true)
    } catch (e) {
      console.error("Failed to open webcam", e)
      alert("Unable to access camera. Please check permissions and try again.")
    } finally {
      setIsLoading(false)
    }
  }


  const handleTestVideoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !file.type.startsWith('video/')) {
      alert("Please select a valid video file")
      return
    }
    
    setIsLoading(true)
    setTestVideoFile(file)
    
    try {
      const videoUrl = URL.createObjectURL(file)
      if (videoRef.current) {
        videoRef.current.srcObject = null
        videoRef.current.src = videoUrl
        videoRef.current.loop = false
        
        await new Promise<void>((resolve) => {
          videoRef.current!.onloadedmetadata = () => {
            if (canvasRef.current && videoRef.current) {
              canvasRef.current.width = videoRef.current.videoWidth
              canvasRef.current.height = videoRef.current.videoHeight
            }
            resolve()
          }
        })
        
        await initPose()
        setTestMode(true)
        setIsStreaming(true)
        
        await videoRef.current.play()
        setIsPlaying(true)
        startPoseLoop()
      }
    } catch (e) {
      console.error("Failed to load test video:", e)
      alert("Failed to load video file")
    } finally {
      setIsLoading(false)
    }
  }


  const togglePlayPause = () => {
    if (!videoRef.current || !testMode) return
    
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      videoRef.current.play()
      setIsPlaying(true)
    }
  }

  const resetTestVideo = () => {
    if (!videoRef.current || !testMode) return
    
    videoRef.current.currentTime = 0
    setRepCount(0)
    setCurrentState("")
    setCurrentAngles({})
    lastStateRef.current = ""
    hasVisitedPeakRef.current = false
    stateChangeTimestampRef.current = 0
    angleFiltersRef.current.clear()
    angleHistoryRef.current = []
    setRepDetails([])
    repFSMRef.current = { phase: 'idle' }
  }

  // NEW: Stop test mode
  const stopTestMode = () => {
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.src = ""
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }
    
    setTestMode(false)
    setIsStreaming(false)
    setIsPlaying(false)
    setTestVideoFile(null)
    setRepCount(0)
    setCurrentState("")
    setCurrentAngles({})
    lastStateRef.current = ""
    hasVisitedPeakRef.current = false
    stateChangeTimestampRef.current = 0
    angleFiltersRef.current.clear()
    angleHistoryRef.current = []
    setRepDetails([])
    repFSMRef.current = { phase: 'idle' }
  }

  const initPose = async () => {
    try {
      if (poseRef.current) return
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm"
      )
      poseRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      })
    } catch (err) {
      console.error("Failed to init MediaPipe Pose", err)
    }
  }

  const startPoseLoop = () => {
    if (!videoRef.current || !canvasRef.current || !poseRef.current) return
    const ctx = canvasRef.current.getContext("2d")
    if (!ctx) return
    const drawer = new DrawingUtils(ctx)
    let frameCount = 0

    const render = () => {
      if (!videoRef.current || !poseRef.current || !canvasRef.current) return
      frameCount++

      if (
        canvasRef.current.width !== videoRef.current.videoWidth ||
        canvasRef.current.height !== videoRef.current.videoHeight
      ) {
        canvasRef.current.width = videoRef.current.videoWidth
        canvasRef.current.height = videoRef.current.videoHeight
      }

      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)

      const ts = performance.now()
      const result = poseRef.current.detectForVideo(videoRef.current, ts)
      
      if (result.landmarks && result.landmarks.length > 0) {
        const landmarks = result.landmarks[0]
        
        const rawAngles = calculateAllAngles(landmarks)
        const smoothedAngles = smoothAngles(rawAngles, ts / 1000)
        
        if (anglesOfInterest && anglesOfInterest[0] === "head_yaw" && frameCount % 30 === 0) {
          console.log('🔍 Head yaw:', smoothedAngles.head_yaw?.toFixed(1), 
                      'Min:', minAngleSeenRef.current.toFixed(1), 
                      'Max:', maxAngleSeenRef.current.toFixed(1),
                      'Thresholds learned:', hasLearnedThresholdsRef.current)
        }
        
        setCurrentAngles(smoothedAngles)
        
        angleHistoryRef.current.push({
          timestamp: ts / 1000,
          angles: smoothedAngles
        })
        
        if (anglesOfInterest && anglesOfInterest.length > 0) {
          let primary = anglesOfInterest[0]
          

          if (exerciseType === 'knee-extension' && 
              anglesOfInterest.includes('left_knee') && 
              anglesOfInterest.includes('right_knee')) {
            
            const history = angleHistoryRef.current
            if (history.length > 15) {
              const recent = history.slice(-15)
              const getRange = (angle: string) => {
                const values = recent.map(h => h.angles[angle] || 0)
                return Math.max(...values) - Math.min(...values)
              }
              
              const leftRange = getRange('left_knee')
              const rightRange = getRange('right_knee')
              
              if (rightRange > leftRange && rightRange > 5) {
                primary = 'right_knee'
              }
            }
          }

          const val = smoothedAngles[primary]
          if (val !== undefined) {
            primaryAngleHistoryRef.current.push({ t: ts / 1000, value: val })
            const cutoffT = (ts / 1000) - 12
            primaryAngleHistoryRef.current = primaryAngleHistoryRef.current.filter(p => p.t > cutoffT)
          }
        }
                const cutoffTime = (ts / 1000) - 10
        angleHistoryRef.current = angleHistoryRef.current.filter(
          h => h.timestamp > cutoffTime
        )
        
        let stateLabel = ""
        if (learnedTemplateRef.current && anglesOfInterest && anglesOfInterest.length > 0) {
          const mapped = mapToTemplateState(smoothedAngles, learnedTemplateRef.current, anglesOfInterest)
          stateLabel = mapped?.name || ""
          if (stateLabel) setTemplateState(stateLabel)
          const primary = getDriverAngle(learnedTemplateRef.current, anglesOfInterest)
          const sortable = learnedTemplateRef.current.states.filter(s => s.angleRanges[primary])
          if (mapped && sortable.length >= 2) {
            const sorted = [...sortable].sort((a, b) => a.angleRanges[primary].mean - b.angleRanges[primary].mean)
            const startId = sorted[0].id
            const peakId = sorted[sorted.length - 1].id
            const MIN_STATE_DURATION = 0.2
            if (mapped.id !== lastStateRef.current) {
              const dt = (ts / 1000) - stateChangeTimestampRef.current
              if (dt >= MIN_STATE_DURATION || lastStateRef.current === "") {
                // Relaxed logic: just check if we reached the target state, ignore where we came from
                // This handles intermediate states (start -> mid -> peak -> mid -> start)
                if (mapped.id === peakId) {
                  hasVisitedPeakRef.current = true
                }
                if (mapped.id === startId && hasVisitedPeakRef.current) {
                  setRepCount(prev => {
                    const newCount = prev + 1
                   if (learnedTemplateRef.current && anglesOfInterest) {
                      const error = calculateRepError(
                        smoothedAngles,
                        learnedTemplateRef.current,
                        anglesOfInterest,
                        newCount,
                        ts / 1000
                      )
                      if (error) {
                        setRepErrors(prevErrors => {
                          const newErrors = [...prevErrors, error]
                          const summary = analyzeRepTrends(newErrors)
                          setErrorSummary(summary)
                          return newErrors
                        })
                      }
                    }
                    return newCount
                  })
                  hasVisitedPeakRef.current = false
                }
                lastStateRef.current = mapped.id
                stateChangeTimestampRef.current = ts / 1000
              }
            }
          }
        } else {
          const state = determineExerciseState(smoothedAngles)
          stateLabel = state
          if (state) {
            setCurrentState(state)
            updateRepCount(state)
          }
        }

        if (learnedTemplateRef.current && anglesOfInterest && anglesOfInterest.length > 0) {
          const score = computeFormScore(smoothedAngles, learnedTemplateRef.current, anglesOfInterest)
          setFormScore(Math.round(score))
          
          const realtimeError = calculateRepError(
            smoothedAngles,
            learnedTemplateRef.current,
            anglesOfInterest,
            repCount + 1,
            ts / 1000
          )
          setCurrentRepError(realtimeError)
          setErrorFeedback(getErrorFeedback(realtimeError))
        }

        // ── Dual-threshold live feedback ──
        if (referenceTemplate && anglesOfInterest && anglesOfInterest.length > 0) {
          const primaryName = anglesOfInterest[0]
          const primaryVal = smoothedAngles[primaryName]
          if (primaryVal !== undefined) {
            setLivePrimaryAngle(primaryVal)
            // Extract reference peak
            let refPeak = 0
            for (const s of referenceTemplate.states) {
              const r = s.angleRanges[primaryName]
              if (r && r.mean > refPeak) refPeak = r.mean
            }
            // Extract ideal peak
            const effectiveIdeal = allowProgression && idealTemplate ? idealTemplate : referenceTemplate
            let idealPeak = 0
            for (const s of effectiveIdeal.states) {
              const r = s.angleRanges[primaryName]
              if (r && r.mean > idealPeak) idealPeak = r.mean
            }
            const TOLERANCE = 0.9
            if (primaryVal >= idealPeak * TOLERANCE) {
              setLiveThresholdStatus("good")
            } else if (primaryVal >= refPeak * TOLERANCE) {
              setLiveThresholdStatus("valid")
            } else {
              setLiveThresholdStatus("below")
            }
          }
        }

        if (anglesOfInterest && anglesOfInterest.length > 0) {
          updateRepCountFromSignal()
        }

        drawer.drawConnectors(landmarks, POSE_CONNECTIONS, {
          color: "#22c55e",
          lineWidth: 8,
        })
        
        drawer.drawLandmarks(landmarks, { 
          radius: 8, 
          fillColor: "#22c55e",
          color: "#16a34a",
          lineWidth: 3 
        })
        
        drawAngleAnnotations(ctx, landmarks, smoothedAngles)
      }

      rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)
  }



  const repSignalStatesRef = useRef<{[key: string]: { 
    lastPeak?: number; 
    lastTrough?: number; 
    lastDirection?: 'up' | 'down' | null; 
    lastChangeT?: number 
  }}>({})
  const lastRepTimeRef = useRef<number>(0)

  const updateRepCountFromSignal = () => {
    let trackingAngles: string[] = []
    if (exerciseType === 'knee-extension') {
      trackingAngles = ['left_knee', 'right_knee']
    } else if (exerciseType === 'scap-wall-slides') {
      trackingAngles = ['left_shoulder', 'right_shoulder']
    } else if (anglesOfInterest && anglesOfInterest.length > 0) {
      trackingAngles = [anglesOfInterest[0]]
    }
    
    trackingAngles = trackingAngles.filter(a => anglesOfInterest?.includes(a))
    
    if (trackingAngles.length === 0) return

    const history = angleHistoryRef.current
    if (history.length < 8) return
    
    trackingAngles.forEach(angleName => {
      if (!repSignalStatesRef.current[angleName]) {
        repSignalStatesRef.current[angleName] = { lastDirection: null, lastChangeT: 0 }
      }
      const state = repSignalStatesRef.current[angleName]
      
      const recent = history.slice(-30).map(h => ({ t: h.timestamp, value: h.angles[angleName] }))
      const validRecent = recent.filter(r => r.value !== undefined) as {t: number, value: number}[]
      
      if (validRecent.length < 5) return
      
      const n = validRecent.length
      const deriv: number[] = []
      for (let i = 1; i < n; i++) {
        const dt = Math.max(0.016, validRecent[i].t - validRecent[i - 1].t)
        deriv.push((validRecent[i].value - validRecent[i - 1].value) / dt)
      }
      
      const alpha = 0.3
      for (let i = 1; i < deriv.length; i++) {
        deriv[i] = alpha * deriv[i] + (1 - alpha) * deriv[i - 1]
      }
      
      const lastIdx = deriv.length - 1
      const curr = deriv[lastIdx]
      const nowT = validRecent[validRecent.length - 1].t
      
      const HYST_DERIV = 2 
      const MIN_INTERVAL = 0.25 
      
      const dir: 'up' | 'down' | null = curr > HYST_DERIV ? 'up' : curr < -HYST_DERIV ? 'down' : (state.lastDirection ?? null)
      
      if (!dir) return
      
      if (dir !== state.lastDirection) {
        if (nowT - (state.lastChangeT || 0) < MIN_INTERVAL) {
          state.lastDirection = dir
          return
        }
        
        if (state.lastDirection === 'up' && dir === 'down') {
          state.lastPeak = validRecent[validRecent.length - 1].value
        }
        
        if (state.lastDirection === 'down' && dir === 'up') {
          state.lastTrough = validRecent[validRecent.length - 1].value
          
          if (state.lastPeak !== undefined && state.lastTrough !== undefined) {
            const rom = Math.abs(state.lastPeak - state.lastTrough)
            
            const windowVals = validRecent.map(p => p.value)
            const observedRange = windowVals.length > 0 ? (Math.max(...windowVals) - Math.min(...windowVals)) : 0
            const MIN_ROM = Math.max(15, observedRange * 0.3)
            
            let PEAK_MIN = 145
            let TROUGH_MAX = 110
            
            if (exerciseType === 'scap-wall-slides') {
               PEAK_MIN = 135 
               TROUGH_MAX = 130 
            } else if (exerciseType === 'knee-extension') {
               PEAK_MIN = 135 
               TROUGH_MAX = 125 
            }
  
            const peakOK = state.lastPeak >= PEAK_MIN
            const troughOK = state.lastTrough <= TROUGH_MAX
            
            if (rom >= MIN_ROM && peakOK && troughOK) {
              if (nowT - lastRepTimeRef.current > 1.0) {
                 console.log(`REP COUNTED on ${angleName}!`)
                 setRepCount(prev => prev + 1)
                 lastRepTimeRef.current = nowT
              }
              state.lastPeak = undefined
            }
          }
        }
        state.lastDirection = dir
        state.lastChangeT = nowT
      }
    })
  }

  const drawAngleAnnotations = (
    ctx: CanvasRenderingContext2D, 
    landmarks: any[], 
    angles: JointAngleData
  ) => {
    const width = canvasRef.current?.width || 640
    const height = canvasRef.current?.height || 480
    
    if (!anglesOfInterest || anglesOfInterest.length === 0) return
    
    const primaryAngle = anglesOfInterest[0]
    const primaryValue = angles[primaryAngle]
    
    if (primaryValue !== undefined) {
      const isFaceExercise = primaryAngle === "head_yaw" || primaryAngle === "nose_horizontal"
      
      if (isFaceExercise) {
        const nose = landmarks[POSE_LANDMARKS.NOSE]
        ctx.fillStyle = "#00ffff"
        ctx.font = "bold 24px Arial"
        ctx.strokeStyle = "#000000"
        ctx.lineWidth = 5
        const text = `${primaryAngle.replace('_', ' ')}: ${Math.round(primaryValue)}°`
        const x = nose.x * width + 20
        const y = nose.y * height - 20
        ctx.strokeText(text, x, y)
        ctx.fillText(text, x, y)
      } else {

        const angleToLandmarkMap: { [key: string]: { landmark: number; offsetX: number; offsetY: number } } = {
          'left_knee': { landmark: POSE_LANDMARKS.LEFT_KNEE, offsetX: -65, offsetY: -10 },
          'right_knee': { landmark: POSE_LANDMARKS.RIGHT_KNEE, offsetX: 15, offsetY: -10 },
          'left_elbow': { landmark: POSE_LANDMARKS.LEFT_ELBOW, offsetX: -65, offsetY: -10 },
          'right_elbow': { landmark: POSE_LANDMARKS.RIGHT_ELBOW, offsetX: 15, offsetY: -10 },
          'left_shoulder': { landmark: POSE_LANDMARKS.LEFT_SHOULDER, offsetX: -75, offsetY: -10 },
          'right_shoulder': { landmark: POSE_LANDMARKS.RIGHT_SHOULDER, offsetX: 15, offsetY: -10 },
          'left_hip': { landmark: POSE_LANDMARKS.LEFT_HIP, offsetX: -65, offsetY: -10 },
          'right_hip': { landmark: POSE_LANDMARKS.RIGHT_HIP, offsetX: 15, offsetY: -10 },
        }
        
        anglesOfInterest
          .filter(angleName => angles[angleName] !== undefined && angleToLandmarkMap[angleName])
          .forEach(angleName => {
            const config = angleToLandmarkMap[angleName]
            const joint = landmarks[config.landmark]
            if (joint) {
              ctx.fillStyle = "#00ffff"
              ctx.font = "bold 20px Arial"
              ctx.strokeStyle = "#000000"
              ctx.lineWidth = 4
              const text = `${Math.round(angles[angleName])}°`
              const x = joint.x * width + config.offsetX
              const y = joint.y * height + config.offsetY
              ctx.strokeText(text, x, y)
              ctx.fillText(text, x, y)
            }
          })
      }
    }
  }

  useEffect(() => {
    try {
      if (exerciseType) {
        const { getTemplatesByExerciseType } = require("@/lib/template-storage")
        const candidates = getTemplatesByExerciseType(exerciseType)
        const match = (exerciseName 
          ? candidates.find((t: { template: import("@/lib/exercise-state-learner").LearnedExerciseTemplate }) => t.template.exerciseName === exerciseName) 
          : candidates[candidates.length - 1]) || null
        if (match) {
          learnedTemplateRef.current = match.template
          setTemplateName(match.template.exerciseName)
        }
      }
    } catch (e) {
      console.info("No learned template loaded for form scoring.")
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (poseRef.current) {
        poseRef.current.close()
        poseRef.current = null
      }
    }
  }, [])

  return (
    <Card className="p-6 space-y-4">
      <div className="flex gap-3">
        <Button onClick={openWebcam} disabled={isStreaming || isLoading} className="gap-2">
          {isLoading ? "Opening…" : "Open Webcam"}
        </Button>
        
        {enableTestMode && !isStreaming && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleTestVideoUpload}
              className="hidden"
            />
            <Button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isLoading}
              variant="outline"
              className="gap-2"
            >
              {isLoading ? "Loading…" : "test with Video File"}
            </Button>
          </>
        )}
        {testMode && isStreaming && (
          <>
            <Button onClick={togglePlayPause} variant="outline">
              {isPlaying ? "Pause" : "▶ Play"}
            </Button>
            <Button onClick={resetTestVideo} variant="outline">
              Reset
            </Button>
            <Button onClick={stopTestMode} variant="destructive">
              Stop Test
            </Button>
          </>
        )}
      </div>

      {testMode && testVideoFile && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border-2 border-yellow-500 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="font-semibold text-yellow-900 dark:text-yellow-100">
                Test Mode Active
              </div>
              <div className="text-sm text-yellow-700 dark:text-yellow-300">
                Testing: {testVideoFile.name}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: 'auto' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-auto"
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
        />
        
        {isStreaming && (
          <>

            <div className={`absolute top-4 left-4 bg-black/80 backdrop-blur-sm rounded-lg px-6 py-4 border-2 ${
              referenceTemplate
                ? liveThresholdStatus === "good"
                  ? "border-green-500"
                  : liveThresholdStatus === "valid"
                    ? "border-yellow-500"
                    : "border-red-500"
                : "border-green-500"
            }`}>
              <div className={`text-sm font-semibold mb-1 ${
                referenceTemplate
                  ? liveThresholdStatus === "good"
                    ? "text-green-400"
                    : liveThresholdStatus === "valid"
                      ? "text-yellow-400"
                      : "text-red-400"
                  : "text-green-400"
              }`}>REPS</div>
              <div className="text-5xl font-bold text-white">{repCount}</div>
              {referenceTemplate && (
                <div className="mt-2 text-[10px] space-y-0.5">
                  <div className={`font-semibold ${
                    liveThresholdStatus === "good"
                      ? "text-green-400"
                      : liveThresholdStatus === "valid"
                        ? "text-yellow-400"
                        : "text-red-400"
                  }`}>
                    {liveThresholdStatus === "good" ? "Ideal ROM reached" :
                     liveThresholdStatus === "valid" ? "Reference ROM reached" :
                     "Below reference"}
                  </div>
                </div>
              )}
            </div>
            

            {(currentState || templateState) && (
              <div className="absolute top-4 right-4 bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-blue-500">
                <div className="text-xs text-blue-400 font-semibold mb-0.5">STATE</div>
                <div className="text-lg font-bold text-white capitalize">{templateState || currentState}</div>
              </div>
            )}
            
            {Object.keys(currentAngles).length > 0 && (
              <div className="absolute bottom-4 left-4 right-4 bg-black/80 backdrop-blur-sm rounded-lg p-2 border border-purple-500/50">
                <div className="text-[10px] text-purple-400 font-semibold mb-0.5">LIVE ANGLES</div>
                <div className="grid grid-cols-4 gap-1">
                  {anglesOfInterest && anglesOfInterest.length > 0 ? (
                    anglesOfInterest.map(angleName => {
                      const angle = currentAngles[angleName]
                      if (angle === undefined) return null
                      
                      return (
                        <div key={angleName} className="flex flex-col">
                          <span className="text-[10px] text-gray-400 capitalize">
                            {angleName.replace(/_/g, ' ')}
                          </span>
                          <span className="text-sm font-bold text-white">
                            {Math.round(angle)}°
                          </span>
                        </div>
                      )
                    })
                  ) : (
                    Object.entries(currentAngles)
                      .filter(([name]) => !name.includes('segment'))
                      .slice(0, 6)
                      .map(([angleName, angle]) => (
                        <div key={angleName} className="flex flex-col">
                          <span className="text-[10px] text-gray-400 capitalize">
                            {angleName.replace(/_/g, ' ')}
                          </span>
                          <span className="text-sm font-bold text-white">
                            {Math.round(angle)}°
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>
            )}

            {repDetails.length > 0 && (
              <div className="absolute bottom-4 left-4 bg-black/80 backdrop-blur-sm rounded-lg p-4 border-2 border-emerald-500">
                <div className="text-sm text-emerald-400 font-semibold mb-2">REP DETAILS</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-auto pr-1">
                  {repDetails.map(rep => (
                    <div key={rep.index} className="flex items-center justify-between gap-3">
                      <div className="text-white text-sm">
                        <span className="font-semibold">#{rep.index}</span>
                        <span className="ml-2 text-gray-300">{rep.primaryAngle.replace(/_/g, ' ')}</span>
                        <span className="ml-2">min <span className="font-bold">{rep.minAngle}°</span></span>
                        <span className="ml-2">max <span className="font-bold">{rep.maxAngle}°</span></span>
                      </div>
                      <div className={rep.correct ? "px-2 py-1 rounded bg-green-600/40 text-green-200 border border-green-500/60 text-xs" : "px-2 py-1 rounded bg-red-600/40 text-red-200 border border-red-500/60 text-xs"}>
                        {rep.correct ? "✔ correct" : "✖ incorrect"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex gap-3 mt-4">
        <Button onClick={openWebcam} disabled={isStreaming || isLoading} className="gap-2">
          {isLoading ? "Opening…" : "Open Webcam"}
        </Button>
        
        {enableTestMode && !isStreaming && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleTestVideoUpload}
              className="hidden"
            />
            <Button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isLoading}
              variant="outline"
              className="gap-2"
            >
              {isLoading ? "Loading..." : "Test with Video File"}
            </Button>
          </>
        )}
        {testMode && isStreaming && (
          <>
            <Button onClick={togglePlayPause} variant="outline">
              {isPlaying ? "Pause" : "▶ Play"}
            </Button>
            <Button onClick={resetTestVideo} variant="outline">
              Reset
            </Button>
            <Button onClick={stopTestMode} variant="destructive">
              Stop Test
            </Button>
          </>
        )}
      </div>

      {testMode && testVideoFile && (
        <div className="mt-4 bg-yellow-50 dark:bg-yellow-950 border-2 border-yellow-500 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="font-semibold text-yellow-900 dark:text-yellow-100">
                Test Mode Active
              </div>
              <div className="text-sm text-yellow-700 dark:text-yellow-300">
                Testing: {testVideoFile.name}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {isStreaming && (
        <>
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
              Realtime Tracking Guide
            </h4>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>Cyan values = Live joint angles</li>
              <li>Stand so your full body is visible</li>
              <li>Perform the exercise slowly and steadily</li>
              {anglesOfInterest?.some(a => a.includes('shoulder') || a.includes('elbow')) && (
                <li>Keep your arms clearly visible to the camera</li>
              )}
              {anglesOfInterest?.some(a => a.includes('knee') || a.includes('hip')) && (
                <li>Ensure your legs are clearly visible</li>
              )}
              {exerciseName && <li>Exercise: {exerciseName}</li>}
            </ul>
          </div>

          {learnedTemplateRef.current && repErrors.length > 0 && (
            <RepErrorGraph 
              repErrors={repErrors} 
              summary={errorSummary}
              width={600}
              height={300}
            />
          )}
        </>
      )}
    </Card>
  )
}

function getDriverAngle(
  template: import("@/lib/exercise-state-learner").LearnedExerciseTemplate,
  anglesOfInterest: string[]
): string {
  let bestAngle = anglesOfInterest[0]
  let maxRange = -1

  for (const angle of anglesOfInterest) {
    const means = template.states.map(s => s.angleRanges[angle]?.mean).filter(m => m !== undefined)
    if (means.length < 2) continue
    const range = Math.max(...means) - Math.min(...means)
    if (range > maxRange) {
      maxRange = range
      bestAngle = angle
    }
  }
  return bestAngle
}

function computeFormScore(
  angles: JointAngleData,
  template: import("@/lib/exercise-state-learner").LearnedExerciseTemplate,
  anglesOfInterest: string[]
): number {
  const primary = getDriverAngle(template, anglesOfInterest)
  const cur = angles[primary]
  if (cur === undefined) return 0
  const candidates = template.states.filter(s => s.angleRanges[primary])
  if (candidates.length === 0) return 0
  const nearest = candidates.reduce((best, s) => {
    const m = s.angleRanges[primary].mean
    const d = Math.abs(cur - m)
    return (!best || d < Math.abs(cur - best.angleRanges[primary].mean)) ? s : best
  }, candidates[0])
  let scores: number[] = []
  anglesOfInterest.forEach(name => {
    const val = angles[name]
    const stats = nearest.angleRanges[name]
    if (val === undefined || !stats) return
    const { mean, stdDev, min, max } = stats
    const clampedVal = Math.max(min, Math.min(max, val))
    const z = Math.abs((clampedVal - mean) / (stdDev || 1))
    const score = Math.max(0, 100 - (z * 20))
    scores.push(score)
  })
  if (scores.length === 0) return 0
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length
  return Math.max(0, Math.min(100, avg))
}

function mapToTemplateState(
  angles: JointAngleData,
  template: import("@/lib/exercise-state-learner").LearnedExerciseTemplate,
  anglesOfInterest: string[]
): { id: string; name: string } | null {
  const primary = getDriverAngle(template, anglesOfInterest)
  const candidates = template.states.filter(s => s.angleRanges[primary])
  if (candidates.length === 0) return null

  // Use Euclidean distance across all angles for robust matching
  const nearest = candidates.reduce((best, state) => {
    const calculateDistance = (s: typeof state) => {
      let sumSquaredDiff = 0
      let count = 0
      
      anglesOfInterest.forEach(angle => {
        const range = s.angleRanges[angle]
        const val = angles[angle]
        if (range && val !== undefined) {
          const diff = val - range.mean
          const scale = range.stdDev > 0 ? range.stdDev : 10
          sumSquaredDiff += Math.pow(diff / scale, 2)
          count++
        }
      })
      
      return count > 0 ? Math.sqrt(sumSquaredDiff / count) : Infinity
    }

    const currentDist = calculateDistance(state)
    const bestDist = calculateDistance(best)
    
    return currentDist < bestDist ? state : best
  }, candidates[0])

  return { id: nearest.id, name: nearest.name }
}

const templateLastStateRef: { current: string | null } = { current: null }
const templateVisitedPeakRef: { current: boolean } = { current: false }
const templateLastChangeTsRef: { current: number } = { current: 0 }

function updateTemplateRepCount(
  mappedStateId: string | null,
  timestamp: number,
  template: import("@/lib/exercise-state-learner").LearnedExerciseTemplate,
  anglesOfInterest: string[]
) {
  if (!mappedStateId) return
  const MIN_STATE_DURATION = 0.2
  const last = templateLastStateRef.current
  if (mappedStateId !== last) {
    const dt = timestamp - templateLastChangeTsRef.current
    if (dt < MIN_STATE_DURATION && last) return
    const primary = anglesOfInterest[0]
    const sortable = template.states.filter(s => s.angleRanges[primary])
    if (sortable.length < 2) {
      templateLastStateRef.current = mappedStateId
      templateLastChangeTsRef.current = timestamp
      return
    }
    const sorted = [...sortable].sort((a, b) => a.angleRanges[primary].mean - b.angleRanges[primary].mean)
    const startId = sorted[0].id
    const peakId = sorted[sorted.length - 1].id
    if (mappedStateId === peakId && last === startId) {
      templateVisitedPeakRef.current = true
    }
    if (mappedStateId === startId && templateVisitedPeakRef.current && last === peakId) {
      // todo
      // Increment the global rep counter in component via a custom event pattern
      // We cannot set state here; instead we rely on calling setRepCount in the render loop (lift state by returning flag)
      // As we are outside component scope, we return nothing; logic moved back to component caller
    }
    templateLastStateRef.current = mappedStateId
    templateLastChangeTsRef.current = timestamp
  }
}
