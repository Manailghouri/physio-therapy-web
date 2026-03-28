"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getExercise } from "@/lib/storage"
import { analyzeVideoForPose } from "@/lib/pose-analyzer"
import { getExerciseConfig } from "@/lib/exercise-config"
import type { LearnedExerciseTemplate } from "@/lib/exercise-state-learner"
import { compareTemplates, type ComparisonResult } from "@/lib/comparison"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Upload, Loader2, CheckCircle2, XCircle, Video } from "lucide-react"
import { ComparisonRecorder } from "@/components/comparison-recorder"



export default function ComparePage() {
  const params = useParams()
  const [exercise, setExercise] = useState<any>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [inputMethod, setInputMethod] = useState<'upload' | 'webcam' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)


  useEffect(() => {
    const ex = getExercise(params.id as string)
    if (ex) {
      console.log("Loaded exercise:", ex)
      console.log("Video URL:", ex.videoUrl)
      setExercise(ex)
    }
  }, [params.id])


  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type.startsWith('video/')) {
      setUploadedFile(file)
      setUploadedVideoUrl(URL.createObjectURL(file))
      setComparisonResult(null)
      setError(null)
    } else {
      setError("Please upload a valid video file")
    }
  }


  const handleVideoRecorded = (videoBlob: Blob) => {
    console.log("[ComparePage] Video recorded, blob size:", videoBlob.size)
    const file = new File([videoBlob], 'recorded-video.webm', { type: 'video/webm' })
    setUploadedFile(file)
    setUploadedVideoUrl(URL.createObjectURL(videoBlob))
    setComparisonResult(null)
    setError(null)
  }


  const compareVideos = async () => {
    if (!uploadedFile || !exercise) return


    setIsAnalyzing(true)
    setError(null)


    try {
      console.log("Starting video comparison...")
      // Check if reference video already has a learned template
      let referenceTemplate: LearnedExerciseTemplate
      if (exercise.learnedTemplate) {
        console.log("Using stored reference template")
        referenceTemplate = exercise.learnedTemplate
      } else {
        console.warn("No stored template found, analyzing reference video...")
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


      console.log(" Analyzing uploaded video...")
      const exerciseConfig = getExerciseConfig(exercise.type)
      const anglesOfInterest = exerciseConfig?.anglesOfInterest
      console.log(`Exercise type: ${exercise.type}`)
      console.log(`Exercise config:`, exerciseConfig)
      console.log(`Using angles of interest:`, anglesOfInterest)
      if (!anglesOfInterest || anglesOfInterest.length === 0) {
        console.warn("No angles of interest found, template learning may not work")
      }
      const uploadedAnalysis = await analyzeVideoForPose(
        uploadedFile,
        anglesOfInterest,
        { name: exercise.name, type: exercise.type }
      )
      console.log("Uploaded analysis result:", uploadedAnalysis)
      console.log("Has learned template?", !!uploadedAnalysis.learnedTemplate)


      if (!uploadedAnalysis.learnedTemplate) {
        throw new Error(`Failed to learn uploaded exercise template. Video may be too short or no valid poses detected. Joint angles found: ${uploadedAnalysis.jointAngles.length}`)
      }


      console.log("Comparing templates...")
      const comparison = compareTemplates(
        referenceTemplate,
        uploadedAnalysis.learnedTemplate
      )


      setComparisonResult(comparison)
      console.log("Comparison complete:", comparison)
    } catch (err) {
      console.error("❌ Error comparing videos:", err)
      setError(err instanceof Error ? err.message : "Failed to compare videos")
    } finally {
      setIsAnalyzing(false)
    }
  }


  if (!exercise) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-2xl mx-auto">
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">Exercise not found</p>
            <Link href="/">
              <Button className="mt-4">Back Home</Button>
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
          <Link href="/">
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
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
                  console.error("Video load error:", e)
                  console.error("Video URL:", exercise.videoUrl)
                  console.error("Error event:", e.currentTarget.error)
                  setVideoError(
                    e.currentTarget.error
                      ? `Error ${e.currentTarget.error.code}: ${e.currentTarget.error.message}`
                      : "Failed to load video"
                  )
                }}
                onLoadedData={() => {
                  console.log("Video loaded successfully")
                  setVideoError(null)
                }}
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
                      onClick={() => {
                        setInputMethod(null)
                        setUploadedFile(null)
                        setUploadedVideoUrl(null)
                        setComparisonResult(null)
                      }}
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
                    onClick={() => {
                      setInputMethod(null)
                      setUploadedFile(null)
                      setUploadedVideoUrl(null)
                      setComparisonResult(null)
                    }}
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

        {/* Comparison Results */}
        {comparisonResult && (
          <Card className="p-6">
            <h2 className="text-2xl font-bold mb-6">Comparison Results</h2>
            {/* Overall Similarity */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg font-semibold">Overall Similarity</span>
                <span className={`text-3xl font-bold ${comparisonResult.similarity >= 80 ? 'text-green-500' :
                  comparisonResult.similarity >= 60 ? 'text-yellow-500' :
                    'text-red-500'
                  }`}>
                  {comparisonResult.similarity}%
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
                <div
                  className={`h-full transition-all ${comparisonResult.similarity >= 80 ? 'bg-green-500' :
                    comparisonResult.similarity >= 60 ? 'bg-yellow-500' :
                      'bg-red-500'
                    }`}
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

            {/* Exercise-specific feedback */}
            {exercise.type === 'scap-wall-slides' && (
              <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  <strong>Bilateral Exercise:</strong> Both arms are tracked together. 
                  Keep both shoulders and elbows moving in sync through the 105-155° range for best results.
                </p>
              </div>
            )}
            {exercise.type === 'knee-extension' && (
              <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  <strong>Single Leg Exercise:</strong> Each leg is tracked independently. 
                  Focus on maintaining control and reaching full extension with each rep.
                </p>
              </div>
            )}


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
                          className={`h-full ${similarity >= 80 ? 'bg-green-500' :
                            similarity >= 60 ? 'bg-yellow-500' :
                              'bg-red-500'
                            }`}
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
                    // Sort to group left/right pairs together
                    const aBase = a.replace(/^(left_|right_)/, '')
                    const bBase = b.replace(/^(left_|right_)/, '')
                    if (aBase === bBase) {
                      return a.includes('left') ? -1 : 1
                    }
                    return a.localeCompare(b)
                  })
                  .map(([angle, deviation]) => {
                    // Format angle names to be more readable
                    const formattedAngle = angle
                      .replace(/_/g, ' ')
                      .replace(/\b\w/g, (char) => char.toUpperCase())
                    
                    return (
                      <Card key={angle} className={`p-3 ${deviation < 10 ? 'bg-green-50 dark:bg-green-950/20' :
                        deviation < 20 ? 'bg-yellow-50 dark:bg-yellow-950/20' :
                          'bg-red-50 dark:bg-red-950/20'
                        }`}>
                        <div className="text-xs text-muted-foreground mb-1">{formattedAngle}</div>
                        <div className="text-xl font-bold">±{Math.round(deviation)}°</div>
                      </Card>
                    )
                  })}
              </div>
            </div>
          </Card>
        )}
      </div>
    </main>
  )
}

