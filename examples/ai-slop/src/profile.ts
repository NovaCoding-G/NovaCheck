// Client-side rendering of untrusted input, straight from an AI suggestion.
export function renderProfile(name: string): void {
  const container = document.getElementById("profile");
  if (!container) return;
  container.innerHTML = `<h1>Welcome ${name}</h1>`;
}
