// replace with live stream view (test a normal video and treat it as livestreamed view)

"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

interface SimpleRecorderProps {
  onRecordComplete: (videoBlob: Blob) => void
  isRecording?: boolean
}

export function SimpleRecorder({ onRecordComplete, isRecording = false }: SimpleRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const [recording, setRecording] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setHasVideo(true)
      }
    } catch (err) {
      console.error("[v0] Error accessing webcam:", err)
    }
  }

  const startRecording = () => {
    if (!streamRef.current) return

    chunksRef.current = []
    mediaRecorderRef.current = new MediaRecorder(streamRef.current)

    mediaRecorderRef.current.ondataavailable = (e) => {
      chunksRef.current.push(e.data)
    }

    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" })
      onRecordComplete(blob)
    }

    mediaRecorderRef.current.start()
    setRecording(true)
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      setRecording(false)
    }
  }

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      setHasVideo(false)
    }
  }

  return (
    <Card className="p-6 space-y-4">
      <div className="aspect-video bg-black rounded-lg overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      </div>

      <div className="flex gap-2">
        {!hasVideo ? (
          <Button onClick={startWebcam} className="flex-1">
            Start Webcam
          </Button>
        ) : (
          <>
            <Button onClick={stopWebcam} variant="outline" className="flex-1 bg-transparent">
              Stop Webcam
            </Button>
            {!recording ? (
              <Button onClick={startRecording} className="flex-1 bg-red-600 hover:bg-red-700">
                Start Recording
              </Button>
            ) : (
              <Button onClick={stopRecording} variant="secondary" className="flex-1">
                Stop Recording
              </Button>
            )}
          </>
        )}
      </div>

      {recording && <p className="text-sm text-red-600 animate-pulse">● Recording...</p>}
    </Card>
  )
}
