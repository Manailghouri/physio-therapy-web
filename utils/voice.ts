export async function speak(text: string) {
  const response = await fetch("/api/voice", {
    method: "POST",
    body: JSON.stringify({ text }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);

  const audio = new Audio(url);
  audio.play();
}