"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { supabase } from "@/utils/supabase/client"
import { analyzeVideoForPose } from "@/lib/pose-analyzer"
import { getExerciseConfig } from "@/lib/exercise-config"
import type { LearnedExerciseTemplate } from "@/lib/exercise-state-learner"
import { compareTemplates, type ComparisonResult } from "@/lib/comparison"
import { scoreSession, type SessionScore } from "@/lib/progress-scorer"
import { getIdealTemplate } from "@/lib/ideal-template-manager"
import { formatAngleName, getSimilarityColor, getSimilarityBg, getDeviationBg } from "@/lib/utils"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Upload, Loader2, CheckCircle2, XCircle, Video, Trophy, Target, TrendingUp, Zap } from "lucide-react"
import { ComparisonRecorder } from "@/components/comparison-recorder"


export default function ComparePage() {
  const params = useParams()
  const [exercise, setExercise] = useState<any>(null)
  const [allowProgression, setAllowProgression] = useState(true)
  const [idealTemplate, setIdealTemplate] = useState<LearnedExerciseTemplate | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null)
  const [sessionScoreResult, setSessionScoreResult] = useState<SessionScore | null>(null)
  const [sessionSaved, setSessionSaved] = useState(false)
  const [sessionSaveError, setSessionSaveError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [inputMethod, setInputMethod] = useState<'upload' | 'webcam' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)


  const resetInputMethod = () => {
    setInputMethod(null)
    setUploadedFile(null)
    setUploadedVideoUrl(null)
    setComparisonResult(null)
    setSessionScoreResult(null)
    setSessionSaved(false)
    setSessionSaveError(null)
  }

  useEffect(() => {
    async function fetchExercise() {
      setIsLoading(true)
      const { data, error } = await supabase
        .from("exercise_assignments")
        .select("id, name, exercise_type, video_url, template, allow_progression")
        .eq("id", params.id as string)
        .single()

      if (!data || error) {
        setIsLoading(false)
        return
      }

      setAllowProgression(data.allow_progression ?? true)

      // Fetch ideal template for this exercise type
      const ideal = await getIdealTemplate(data.exercise_type)
      setIdealTemplate(ideal)

      // Get a signed URL for the private storage bucket
      let videoUrl = data.video_url
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        try {
          const res = await fetch(`/api/exercises/signed-url?id=${data.id}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          if (res.ok) {
            const { signedUrl } = await res.json()
            videoUrl = signedUrl
          }
        } catch (e) {
          console.error("Failed to get signed URL, falling back to stored URL:", e)
        }
      }

      setExercise({
        id: data.id,
        name: data.name,
        type: data.exercise_type,
        videoUrl,
        learnedTemplate: data.template,
      })
      setIsLoading(false)
    }
    fetchExercise()
  }, [params.id])


  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type.startsWith('video/')) {
      setUploadedFile(file)
      setUploadedVideoUrl(URL.createObjectURL(file))
      setComparisonResult(null)
      setSessionScoreResult(null)
      setError(null)
    } else {
      setError("Please upload a valid video file")
    }
  }


  const handleVideoRecorded = (videoBlob: Blob) => {
    const file = new File([videoBlob], 'recorded-video.webm', { type: 'video/webm' })
    setUploadedFile(file)
    setUploadedVideoUrl(URL.createObjectURL(videoBlob))
    setComparisonResult(null)
    setSessionScoreResult(null)
    setError(null)
  }

  /** Save session results to the API */
  const saveSession = async (
    comparison: ComparisonResult,
    score: SessionScore
  ) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch("/api/exercises/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          assignment_id: exercise.id,
          similarity_score: comparison.similarity,
          reps_completed: score.totalReps,
          reps_expected: comparison.referenceReps,
          state_matches: comparison.details.stateMatches,
          angle_deviations: comparison.details.angleDeviations,
          duration_seconds: 0,
          valid_reps: score.validReps,
          good_reps: score.goodReps,
          progress_score: score.progressScore,
          form_score: score.formScore,
        }),
      })

      if (res.ok) {
        setSessionSaved(true)
      } else {
        const data = await res.json()
        setSessionSaveError(data.error || "Failed to save session")
      }
    } catch (err) {
      console.error("Error saving session:", err)
      setSessionSaveError("Failed to save session")
    }
  }


  const compareVideos = async () => {
    if (!uploadedFile || !exercise) return

    setIsAnalyzing(true)
    setError(null)

    try {
      let referenceTemplate: LearnedExerciseTemplate
      if (exercise.learnedTemplate) {
        referenceTemplate = exercise.learnedTemplate
      } else {
        const referenceBlob = await fetch(exercise.videoUrl).then(r => r.blob())
        const referenceAnalysis = await analyzeVideoForPose(
          referenceBlob,
          undefined,
          { name: exercise.name, type: exercise.type }
        )
        if (!referenceAnalysis.learnedTemplate) {
          throw new Error("Failed to learn reference exercise template")
        }
        referenceTemplate = referenceAnalysis.learnedTemplate
      }

      const exerciseConfig = getExerciseConfig(exercise.type)
      const anglesOfInterest = exerciseConfig?.anglesOfInterest

      const uploadedAnalysis = await analyzeVideoForPose(
        uploadedFile,
        anglesOfInterest,
        { name: exercise.name, type: exercise.type }
      )

      if (!uploadedAnalysis.learnedTemplate) {
        throw new Error(`Failed to learn uploaded exercise template. Video may be too short or no valid poses detected. Joint angles found: ${uploadedAnalysis.jointAngles.length}`)
      }

      // Legacy comparison (state similarity + angle deviation)
      const comparison = compareTemplates(
        referenceTemplate,
        uploadedAnalysis.learnedTemplate
      )
      setComparisonResult(comparison)

      // New dual-threshold scoring
      const score = scoreSession(
        referenceTemplate,
        idealTemplate,
        uploadedAnalysis.learnedTemplate,
        allowProgression
      )
      setSessionScoreResult(score)

      // Auto-save session
      await saveSession(comparison, score)
    } catch (err) {
      console.error("Error comparing videos:", err)
      setError(err instanceof Error ? err.message : "Failed to compare videos")
    } finally {
      setIsAnalyzing(false)
    }
  }


  if (isLoading) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-2xl mx-auto">
          <Card className="p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            <p className="text-muted-foreground">Loading exercise...</p>
          </Card>
        </div>
      </main>
    )
  }

  if (!exercise) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-2xl mx-auto">
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">Exercise not found</p>
            <Link href="/patient">
              <Button className="mt-4">Back to Dashboard</Button>
            </Link>
          </Card>
        </div>
      </main>
    )
  }


  return (
    <main className="min-h-screen bg-background p-2 md:p-4">
      <div className="w-full max-w-[98vw] mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <Link href="/patient">
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
          {sessionSaved && (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Saved to your record
            </span>
          )}
          {sessionSaveError && (
            <span className="text-xs text-destructive">{sessionSaveError}</span>
          )}
        </div>

        <div>
          <h1 className="text-2xl font-bold mb-1">Compare Videos - {exercise.name}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left Column: Reference Video */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Reference Video</h2>
            <Card className="overflow-hidden bg-black border-0">
              {videoError && (
                <div className="text-sm text-destructive p-4 text-center bg-muted">
                  <p className="font-semibold mb-2">Video Load Error:</p>
                  <p>{videoError}</p>
                  <p className="text-xs mt-2 opacity-70">URL: {exercise.videoUrl}</p>
                </div>
              )}
              <video
                ref={videoRef}
                controls
                loop
                muted
                autoPlay
                playsInline
                className="w-full h-auto block"
                crossOrigin="anonymous"
                onError={(e) => {
                  setVideoError(
                    e.currentTarget.error
                      ? `Error ${e.currentTarget.error.code}: ${e.currentTarget.error.message}`
                      : "Failed to load video"
                  )
                }}
                onLoadedData={() => setVideoError(null)}
              >
                <source src={exercise.videoUrl} type="video/webm" />
                <source src={exercise.videoUrl} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </Card>
          </div>

          {/* Right Column: User Input / Video */}
          <div className="space-y-2">
            {/* Input Method Selection */}
            {!inputMethod && (
              <div className="grid grid-cols-1 gap-4">
                <Card
                  className="p-6 cursor-pointer hover:border-primary transition-colors"
                  onClick={() => setInputMethod('upload')}
                >
                  <div className="flex items-center gap-4">
                    <Upload className="w-8 h-8 text-primary" />
                    <div>
                      <h3 className="text-lg font-semibold">Upload Video</h3>
                      <p className="text-sm text-muted-foreground">
                        Upload a pre-recorded video file
                      </p>
                    </div>
                  </div>
                </Card>
                <Card
                  className="p-6 cursor-pointer hover:border-primary transition-colors"
                  onClick={() => setInputMethod('webcam')}
                >
                  <div className="flex items-center gap-4">
                    <Video className="w-8 h-8 text-primary" />
                    <div>
                      <h3 className="text-lg font-semibold">Record with Webcam</h3>
                      <p className="text-sm text-muted-foreground">
                        Record using your webcam with real-time detection
                      </p>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* Video Upload Section */}
            {inputMethod === 'upload' && (
              <div className="space-y-4">
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Upload Video</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetInputMethod}
                    >
                      Change Method
                    </Button>
                  </div>
                  <div className="flex items-center gap-4">
                    <Input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      onChange={handleFileUpload}
                      className="flex-1"
                    />
                    {uploadedFile && (
                      <Button
                        onClick={compareVideos}
                        disabled={isAnalyzing}
                        className="gap-2"
                      >
                        {isAnalyzing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4" />
                            Compare
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  {error && (
                    <div className="mt-4 p-3 bg-destructive/10 border border-destructive rounded-md">
                      <p className="text-sm text-destructive">{error}</p>
                    </div>
                  )}
                </Card>

                {uploadedVideoUrl && (
                  <div className="space-y-3">
                    <h2 className="text-lg font-semibold">Your Video</h2>
                    <Card className="p-4 bg-muted aspect-video flex items-center justify-center rounded-lg overflow-hidden">
                      <video
                        controls
                        loop
                        className="w-full h-full object-contain rounded"
                      >
                        <source src={uploadedVideoUrl} type="video/webm" />
                        <source src={uploadedVideoUrl} type="video/mp4" />
                        Your browser does not support the video tag.
                      </video>
                    </Card>
                  </div>
                )}
              </div>
            )}

            {/* Webcam Recording Section */}
            {inputMethod === 'webcam' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Record Using Webcam</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetInputMethod}
                  >
                    Change Method
                  </Button>
                </div>
                <ComparisonRecorder
                  onVideoRecorded={handleVideoRecorded}
                  anglesOfInterest={getExerciseConfig(exercise?.type)?.anglesOfInterest || ["right_knee"]}
                  exerciseName={exercise?.name}
                  exerciseType={exercise?.type}
                  enableTestMode={true}
                  referenceTemplate={exercise?.learnedTemplate}
                  idealTemplate={idealTemplate ?? undefined}
                  allowProgression={allowProgression}
                />
                {uploadedFile && (
                  <Card className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">Video recorded successfully!</p>
                      <Button
                        onClick={compareVideos}
                        disabled={isAnalyzing}
                        className="gap-2"
                      >
                        {isAnalyzing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4" />
                            Compare Videos
                          </>
                        )}
                      </Button>
                    </div>
                  </Card>
                )}
                {error && (
                  <div className="p-3 bg-destructive/10 border border-destructive rounded-md">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── New: Progress Score Results ── */}
        {sessionScoreResult && (
          <Card className="p-6">
            <h2 className="text-2xl font-bold mb-6">Exercise Score</h2>

            {/* Score cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <ScoreCard
                label="Valid Reps"
                value={`${sessionScoreResult.validReps}/${sessionScoreResult.totalReps}`}
                icon={<Target className="w-4 h-4" />}
                color={sessionScoreResult.validReps > 0 ? "text-green-600" : "text-muted-foreground"}
                bg={sessionScoreResult.validReps > 0 ? "bg-green-50 dark:bg-green-950/30" : "bg-muted"}
              />
              <ScoreCard
                label={allowProgression ? "Good Reps" : "Good Reps"}
                value={`${sessionScoreResult.goodReps}/${sessionScoreResult.totalReps}`}
                icon={<Trophy className="w-4 h-4" />}
                color={sessionScoreResult.goodReps > 0 ? "text-amber-600" : "text-muted-foreground"}
                bg={sessionScoreResult.goodReps > 0 ? "bg-amber-50 dark:bg-amber-950/30" : "bg-muted"}
              />
              <ScoreCard
                label="Progress"
                value={`${sessionScoreResult.progressScore}%`}
                icon={<TrendingUp className="w-4 h-4" />}
                color={getProgressColor(sessionScoreResult.progressScore)}
                bg={getProgressBg(sessionScoreResult.progressScore)}
              />
              <ScoreCard
                label="Form"
                value={`${sessionScoreResult.formScore}%`}
                icon={<Zap className="w-4 h-4" />}
                color={getProgressColor(sessionScoreResult.formScore)}
                bg={getProgressBg(sessionScoreResult.formScore)}
              />
            </div>

            {/* Progress bar: ref → patient → ideal */}
            {allowProgression && idealTemplate && (
              <div className="mb-6 p-4 rounded-lg bg-muted/50">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Range of Motion Progress
                </p>
                <div className="relative h-4 bg-muted rounded-full overflow-hidden">
                  {/* Reference marker (left side) */}
                  <div className="absolute left-0 top-0 h-full bg-yellow-400/30" style={{ width: "100%" }} />
                  {/* Patient progress */}
                  <div
                    className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                      sessionScoreResult.progressScore >= 90
                        ? "bg-green-500"
                        : sessionScoreResult.progressScore >= 50
                          ? "bg-yellow-500"
                          : "bg-red-500"
                    }`}
                    style={{ width: `${sessionScoreResult.progressScore}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>Reference (floor)</span>
                  <span>Ideal (ceiling)</span>
                </div>
              </div>
            )}

            {/* Per-rep breakdown */}
            {sessionScoreResult.perRepDetails.length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3">Rep Breakdown</h3>
                <div className="space-y-2">
                  {sessionScoreResult.perRepDetails.map((rep) => (
                    <div
                      key={rep.rep}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md border ${
                        rep.good
                          ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20"
                          : rep.valid
                            ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/20"
                            : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
                      }`}
                    >
                      <span className="text-sm font-semibold w-8">#{rep.rep}</span>
                      <span className="text-sm">
                        Peak: <strong>{Math.round(rep.peakAngle)}°</strong>
                      </span>
                      <div className="flex-1" />
                      {rep.valid && (
                        <span className="text-xs text-muted-foreground">
                          Progress: {rep.progressPercent}%
                        </span>
                      )}
                      <span className="text-xs font-medium">
                        Form: {rep.formScore}%
                      </span>
                      {rep.good ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 font-medium">
                          Good
                        </span>
                      ) : rep.valid ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400 font-medium">
                          Valid
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 font-medium">
                          Below ref
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mode indicator */}
            <p className="text-xs text-muted-foreground">
              Mode: {allowProgression ? "Progression enabled — good reps require reaching ideal ROM" : "Stick with reference — all valid reps count as good"}
            </p>
          </Card>
        )}

        {/* ── Legacy: Comparison Results ── */}
        {comparisonResult && (
          <Card className="p-6">
            <h2 className="text-2xl font-bold mb-6">Detailed Comparison</h2>
            {/* Overall Similarity */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg font-semibold">Overall Similarity</span>
                <span className={`text-3xl font-bold ${getSimilarityColor(comparisonResult.similarity)}`}>
                  {comparisonResult.similarity}%
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
                <div
                  className={`h-full transition-all ${getSimilarityBg(comparisonResult.similarity)}`}
                  style={{ width: `${comparisonResult.similarity}%` }}
                />
              </div>
            </div>


            {/* Rep Counts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <Card className="p-4 bg-blue-50 dark:bg-blue-950/20">
                <div className="text-sm text-muted-foreground mb-1">Reference Reps</div>
                <div className="text-3xl font-bold">{comparisonResult.referenceReps}</div>
              </Card>
              <Card className="p-4 bg-purple-50 dark:bg-purple-950/20">
                <div className="text-sm text-muted-foreground mb-1">Your Reps</div>
                <div className="text-3xl font-bold">{comparisonResult.uploadedReps}</div>
              </Card>
            </div>

            {/* State Matches */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">State Accuracy</h3>
              <div className="space-y-2">
                {Object.entries(comparisonResult.details.stateMatches).map(([state, similarity]) => (
                  <div key={state} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{state}</span>
                        <span className="text-sm text-muted-foreground">{Math.round(similarity)}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full ${getSimilarityBg(similarity)}`}
                          style={{ width: `${similarity}%` }}
                        />
                      </div>
                    </div>
                    {similarity >= 80 ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )}
                  </div>
                ))}
              </div>
            </div>


            {/* Angle Deviations */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Angle Deviations</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(comparisonResult.details.angleDeviations)
                  .sort(([a], [b]) => {
                    const aBase = a.replace(/^(left_|right_)/, '')
                    const bBase = b.replace(/^(left_|right_)/, '')
                    if (aBase === bBase) {
                      return a.includes('left') ? -1 : 1
                    }
                    return a.localeCompare(b)
                  })
                  .map(([angle, deviation]) => (
                      <Card key={angle} className={`p-3 ${getDeviationBg(deviation)}`}>
                        <div className="text-xs text-muted-foreground mb-1">{formatAngleName(angle)}</div>
                        <div className="text-xl font-bold">±{Math.round(deviation)}°</div>
                      </Card>
                  ))}
              </div>
            </div>
          </Card>
        )}
      </div>
    </main>
  )
}

// ── Helper components ─────────────────────────────────────────────

function ScoreCard({
  label, value, icon, color, bg,
}: {
  label: string
  value: string
  icon: React.ReactNode
  color: string
  bg: string
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1.5 rounded-md ${bg}`}>
          <span className={color}>{icon}</span>
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </Card>
  )
}

function getProgressColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400"
  if (score >= 50) return "text-yellow-600 dark:text-yellow-400"
  return "text-red-600 dark:text-red-400"
}

function getProgressBg(score: number): string {
  if (score >= 80) return "bg-green-50 dark:bg-green-950/30"
  if (score >= 50) return "bg-yellow-50 dark:bg-yellow-950/30"
  return "bg-red-50 dark:bg-red-950/30"
}
