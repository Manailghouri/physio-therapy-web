"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import Link from "next/link"
import { getAllExercises, deleteExercise, type ExerciseVideo } from "@/lib/storage"


// storing learnt states in usestate for now 
// will connect with supabase later after setting up user profiles and auth

export default function Home() {
  const [exercises, setExercises] = useState<ExerciseVideo[]>([]) 

  useEffect(() => {
    setExercises(getAllExercises())
  }, [])

  const handleDeleteExercise = async (id: string) => {
    await deleteExercise(id)
    setExercises(getAllExercises())
  }

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto">
         <div className="space-y-6">
            <div className="text-center space-y-2 mb-8">
              <h1 className="text-4xl font-bold">Physiotherapy Guidance System</h1>
              <p className="text-muted-foreground">Proof of Concept</p>
            </div>

            <Button size="lg" className="w-full">
              <Link href={"/record"}>
              Record New Exercise
              </Link>    
            </Button>

            {exercises.length === 0 ? (
              <Card className="p-12 text-center">
                <p className="text-muted-foreground mb-4">No exercises recorded yet</p>
                <p className="text-sm text-muted-foreground">Start by recording your first exercise video</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {exercises.map((exercise) => (
                  <Card key={exercise.id} className="p-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{exercise.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {new Date(exercise.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/compare/${exercise.id}`}>
                        <Button size="sm" variant="secondary">
                          Compare
                        </Button>
                      </Link>
                      <Button size="sm" variant="outline" onClick={() => handleDeleteExercise(exercise.id)}>
                        Delete
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
      </div>
    </main>
  )
}
