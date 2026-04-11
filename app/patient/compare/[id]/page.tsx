"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { supabase } from "@/utils/supabase/client"
import { analyzeVideoForPose } from "@/lib/pose-analyzer"
import { getExerciseConfig } from "@/lib/exercise-config"
import type { LearnedExerciseTemplate } from "@/lib/exercise-state-learner"
import { compareTemplates, type ComparisonResult } from "@/lib/comparison"
import { scoreSession, type SessionScore } from "@/lib/progress-scorer"
import { getIdealTemplate } from "@/lib/ideal-template-manager"
import { getSimilarityBg } from "@/lib/utils"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Upload, Loader2, CheckCircle2, Video } from "lucide-react"
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
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-white" />
          <p className="text-white/60">Loading exercise...</p>
        </div>
      </div>
    )
  }

  if (!exercise) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/60 mb-4">Exercise not found</p>
          <Link href="/patient">
            <Button>Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    )
  }


  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <Link href="/patient" className="pointer-events-auto">
          <Button
            variant="outline"
            size="sm"
            className="bg-black/60 text-white border-white/30 hover:bg-white/10"
          >
            ← Back
          </Button>
        </Link>
        <h1 className="text-white font-semibold text-lg">{exercise.name}</h1>
        <div className="flex items-center gap-2">
          {sessionSaved && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </span>
          )}
          {sessionSaveError && (
            <span className="text-xs text-red-400">{sessionSaveError}</span>
          )}
        </div>
      </div>

      {/* Split screen */}
      <div className="flex-1 flex min-h-0">
        {/* ── Left panel: Reference Video ── */}
        <div className="w-1/2 h-full relative flex items-center justify-center bg-black border-r border-white/10">
          {videoError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
              <div className="text-sm text-red-400 text-center p-4">
                <p className="font-semibold mb-2">Video Load Error</p>
                <p>{videoError}</p>
              </div>
            </div>
          )}
          <video
            ref={videoRef}
            controls
            loop
            muted
            autoPlay
            playsInline
            className="w-full h-full object-contain"
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
          </video>
          <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm rounded px-3 py-1.5">
            <span className="text-xs font-medium text-white/80">Reference</span>
          </div>
        </div>

        {/* ── Right panel: dynamic content ── */}
        <div className="w-1/2 h-full relative bg-black">

          {/* === Mode selector (no method chosen yet) === */}
          {!inputMethod && (
            <div className="h-full flex flex-col items-center justify-center gap-6 px-8">
              <h2 className="text-white text-xl font-semibold mb-2">Choose Input</h2>

              <button
                onClick={() => setInputMethod('webcam')}
                className="w-full max-w-sm flex items-center gap-4 rounded-xl border-2 border-white/20 bg-white/5 hover:bg-white/10 hover:border-green-500/60 transition-all p-6 text-left"
              >
                <Video className="w-10 h-10 text-green-400 shrink-0" />
                <div>
                  <div className="text-white font-semibold text-lg">Record with Webcam</div>
                  <div className="text-white/50 text-sm">Real-time pose detection & feedback</div>
                </div>
              </button>

              <button
                onClick={() => setInputMethod('upload')}
                className="w-full max-w-sm flex items-center gap-4 rounded-xl border-2 border-white/20 bg-white/5 hover:bg-white/10 hover:border-blue-500/60 transition-all p-6 text-left"
              >
                <Upload className="w-10 h-10 text-blue-400 shrink-0" />
                <div>
                  <div className="text-white font-semibold text-lg">Upload Video</div>
                  <div className="text-white/50 text-sm">Compare a pre-recorded video</div>
                </div>
              </button>
            </div>
          )}

          {/* === Webcam mode === */}
          {inputMethod === 'webcam' && (
            <>
              <ComparisonRecorder
                fullscreen
                onVideoRecorded={handleVideoRecorded}
                anglesOfInterest={getExerciseConfig(exercise?.type)?.anglesOfInterest || ["right_knee"]}
                exerciseName={exercise?.name}
                exerciseType={exercise?.type}
                enableTestMode={true}
                referenceTemplate={exercise?.learnedTemplate}
                idealTemplate={idealTemplate ?? undefined}
                allowProgression={allowProgression}
              />
              <button
                onClick={resetInputMethod}
                className="absolute top-14 right-4 z-10 text-[10px] text-white/50 hover:text-white/80 bg-black/40 hover:bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 transition-colors"
              >
                Change method
              </button>
              <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-sm rounded px-3 py-1.5 pointer-events-none">
                <span className="text-xs font-medium text-white/80">Your Exercise</span>
              </div>
              {uploadedFile && (
                <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/90 to-transparent px-4 py-3 flex items-center justify-center gap-4">
                  <p className="text-sm text-white/70">Video recorded</p>
                  <Button onClick={compareVideos} disabled={isAnalyzing} className="gap-2">
                    {isAnalyzing ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Analyzing...</>
                    ) : (
                      <><Upload className="w-4 h-4" />Compare Videos</>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}

          {/* === Upload mode === */}
          {inputMethod === 'upload' && (
            <div className="h-full flex flex-col">
              {/* Upload controls */}
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-white text-lg font-semibold">Upload Video</h2>
                  <button
                    onClick={resetInputMethod}
                    className="text-xs text-white/50 hover:text-white/80 bg-white/5 hover:bg-white/10 rounded-full px-3 py-1 transition-colors"
                  >
                    Change method
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    onChange={handleFileUpload}
                    className="flex-1 bg-white/5 border-white/20 text-white file:text-white/70"
                  />
                  {uploadedFile && (
                    <Button onClick={compareVideos} disabled={isAnalyzing} className="gap-2 shrink-0">
                      {isAnalyzing ? (
                        <><Loader2 className="w-4 h-4 animate-spin" />Analyzing...</>
                      ) : (
                        <><Upload className="w-4 h-4" />Compare</>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* Uploaded video preview */}
              {uploadedVideoUrl && !sessionScoreResult && !comparisonResult && (
                <div className="flex-1 min-h-0 relative">
                  <video controls loop className="w-full h-full object-contain">
                    <source src={uploadedVideoUrl} type="video/webm" />
                    <source src={uploadedVideoUrl} type="video/mp4" />
                  </video>
                  <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-sm rounded px-3 py-1.5 pointer-events-none">
                    <span className="text-xs font-medium text-white/80">Your Video</span>
                  </div>
                </div>
              )}

              {/* Results scroll area (inside right panel) */}
              {(sessionScoreResult || comparisonResult) && (
                <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                  {sessionScoreResult && (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
                      <h2 className="text-lg font-bold text-white">Exercise Score</h2>
                      <div className="grid grid-cols-2 gap-2">
                        <DarkScoreCard label="Valid Reps" value={`${sessionScoreResult.validReps}/${sessionScoreResult.totalReps}`} color={sessionScoreResult.validReps > 0 ? "text-green-400" : "text-white/40"} />
                        <DarkScoreCard label="Good Reps" value={`${sessionScoreResult.goodReps}/${sessionScoreResult.totalReps}`} color={sessionScoreResult.goodReps > 0 ? "text-amber-400" : "text-white/40"} />
                        <DarkScoreCard label="Progress" value={`${sessionScoreResult.progressScore}%`} color={sessionScoreResult.progressScore >= 80 ? "text-green-400" : sessionScoreResult.progressScore >= 50 ? "text-yellow-400" : "text-red-400"} />
                        <DarkScoreCard label="Form" value={`${sessionScoreResult.formScore}%`} color={sessionScoreResult.formScore >= 80 ? "text-green-400" : sessionScoreResult.formScore >= 50 ? "text-yellow-400" : "text-red-400"} />
                      </div>

                      {sessionScoreResult.perRepDetails.length > 0 && (
                        <div className="space-y-1.5">
                          <h3 className="text-sm font-semibold text-white/70">Rep Breakdown</h3>
                          {sessionScoreResult.perRepDetails.map((rep) => (
                            <div
                              key={rep.rep}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs border ${
                                rep.good
                                  ? "border-green-500/30 bg-green-500/10 text-green-300"
                                  : rep.valid
                                    ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                                    : "border-red-500/30 bg-red-500/10 text-red-300"
                              }`}
                            >
                              <span className="font-semibold">#{rep.rep}</span>
                              <span>Peak: {Math.round(rep.peakAngle)}°</span>
                              <span className="flex-1" />
                              <span>Form: {rep.formScore}%</span>
                              <span className="font-medium">{rep.good ? "Good" : rep.valid ? "Valid" : "Below"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {comparisonResult && (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
                      <h2 className="text-lg font-bold text-white">Detailed Comparison</h2>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/70">Overall Similarity</span>
                        <span className={`text-2xl font-bold ${getSimilarityColor(comparisonResult.similarity)}`}>
                          {comparisonResult.similarity}%
                        </span>
                      </div>
                      <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full transition-all ${getSimilarityBg(comparisonResult.similarity)}`}
                          style={{ width: `${comparisonResult.similarity}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <DarkScoreCard label="Reference Reps" value={`${comparisonResult.referenceReps}`} color="text-blue-400" />
                        <DarkScoreCard label="Your Reps" value={`${comparisonResult.uploadedReps}`} color="text-purple-400" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 p-3 bg-red-900/80 border border-red-500 rounded-md max-w-md">
          <p className="text-sm text-red-200">{error}</p>
        </div>
      )}
    </div>
  )
}

// ── Helper components ─────────────────────────────────────────────

function DarkScoreCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 p-3">
      <div className="text-[10px] text-white/50 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

function getSimilarityColor(score: number): string {
  if (score >= 80) return "text-green-400"
  if (score >= 50) return "text-yellow-400"
  return "text-red-400"
}
