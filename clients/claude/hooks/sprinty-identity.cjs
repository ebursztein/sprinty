// Claude supplies the caller identity; the model never needs to remember a token.
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (!/^mcp__[^\s]*sprinty[^\s]*__/.test(event.tool_name ?? "") || !event.session_id) return;
    const updatedInput = { ...event.tool_input, client_session_id: event.session_id, client_agent_id: event.agent_id ?? "main" };
    delete updatedInput.agent_token;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput } }));
  } catch (error) {
    process.stderr.write("Sprinty identity hook failed: " + error.message + "\n");
    process.exitCode = 2;
  }
});
