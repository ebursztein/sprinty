const commands = {
  install: "curl -fsSL https://ebursztein.github.io/sprinty/install.sh | sh",
  server: "npx -y sprinty-mcp@latest",
};
let prompt;
let toastTimer;
const toast = document.querySelector(".copy-toast");
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    try {
      const kind = button.dataset.copy;
      if (kind === "prompt" && !prompt) {
        const response = await fetch("agent-start.txt");
        if (!response.ok) throw new Error("Prompt unavailable");
        prompt = await response.text();
      }
      await navigator.clipboard.writeText(
        kind === "prompt" ? prompt : commands[kind],
      );
      toast.textContent =
        kind === "prompt"
          ? "Setup prompt copied. Paste it into your coding agent."
          : "Command copied.";
    } catch {
      toast.textContent =
        button.dataset.copy === "prompt"
          ? "Copy unavailable. Open agent-start.txt to select the prompt."
          : "Copy unavailable. Select the command and copy it manually.";
    }
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 5000);
  });
}
