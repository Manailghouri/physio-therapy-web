import { supabase } from "@/utils/supabase/client"
import type { LearnedExerciseTemplate } from "./exercise-state-learner"

export interface ExerciseVideo {
  id: string
  name: string
  type: string
  videoUrl: string
  timestamp: number
  storedInSupabase?: boolean
  learnedTemplate?: LearnedExerciseTemplate
}

const STORAGE_KEY = "exercise-videos"
const SUPABASE_BUCKET = "reference-videos"

// to be removed once storage functionality is working (keeping these as reference for now)
function getVideos(): ExerciseVideo[] {
  if (typeof window === "undefined") return []
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? (JSON.parse(data) as ExerciseVideo[]) : []
  } catch (e) {
    console.error("Error loading exercise videos:", e)
    return []
  }
}


// to be removed
function saveVideos(videos: ExerciseVideo[]) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(videos))
  } catch (e: any) {
    console.error("Error saving exercise videos metadata:", e)
  }
}

// keeping for reference rn
export async function saveExerciseVideo(
  name: string,
  videoBlob: Blob,
  exerciseType: string = "knee-extension",
  learnedTemplate?: LearnedExerciseTemplate
): Promise<ExerciseVideo> {
  const id = Date.now().toString()

  try {
    const fileName = `${id}_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.webm`
    const filePath = `${exerciseType}/${fileName}`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(filePath, videoBlob, {
        contentType: videoBlob.type || 'video/webm',
        cacheControl: '3600',
        upsert: false
      })

    if (uploadError) {
      throw new Error(`Failed to upload video: ${uploadError.message}`)
    }

    const { data: urlData } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(filePath)

    if (!urlData?.publicUrl) {
      throw new Error("Failed to get public URL for uploaded video")
    }

    const video: ExerciseVideo = {
      id,
      name,
      type: exerciseType,
      videoUrl: urlData.publicUrl,
      timestamp: Date.now(),
      storedInSupabase: true,
      learnedTemplate
    }

    const videos = getVideos()
    videos.push(video)
    saveVideos(videos)

    return video

  } catch (err) {
    console.error("Error in saveExerciseVideo:", err)
    throw err
  }
}

export interface UploadResult {
  videoUrl: string
  videoPath: string
}


export async function uploadVideoToStorage(
  name: string,
  videoBlob: Blob,
  exerciseType: string
): Promise<UploadResult> {
  const id = Date.now().toString()
  const fileName = `${id}_${name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.webm`
  const filePath = `${exerciseType}/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(filePath, videoBlob, {
      contentType: videoBlob.type || "video/webm",
      cacheControl: "3600",
      upsert: false,
    })

  if (uploadError) {
    throw new Error(`Failed to upload video: ${uploadError.message}`)
  }

  const { data: urlData } = supabase.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(filePath)

  if (!urlData?.publicUrl) {
    throw new Error("Failed to get public URL for uploaded video")
  }


  
  return { videoUrl: urlData.publicUrl, videoPath: filePath }
}

export function getAllExercises(): ExerciseVideo[] {
  return getVideos()
}

export function getExercise(id: string): ExerciseVideo | undefined {
  return getVideos().find((v) => v.id === id)
}

export async function deleteExercise(id: string): Promise<boolean> {
  const videos = getVideos()
  const videoToDelete = videos.find((v) => v.id === id)

  if (!videoToDelete) return false

  if (videoToDelete.storedInSupabase) {
    try {
      const url = new URL(videoToDelete.videoUrl)
      const pathParts = url.pathname.split('/storage/v1/object/public/' + SUPABASE_BUCKET + '/')
      if (pathParts.length > 1) {
        const filePath = pathParts[1]
        const { error } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .remove([filePath])
        if (error) console.error("Error deleting from Supabase:", error)
      }
    } catch (err) {
      console.error("Error deleting from Supabase:", err)
    }
  }

  saveVideos(videos.filter((v) => v.id !== id))
  return true
}

export function clearAllExercises(): void {
  localStorage.removeItem(STORAGE_KEY)
}
