// Agent CLI behavior simulator — encodes the bugs we've found by running real CLIs.
// Given a prompt string, simulates what the agent CLI would return.
// This lets us test prompt format bugs WITHOUT spawning real processes.
//
// Known bug patterns encoded here:
// 1. shell:true + cmd.exe on Windows: \n in prompt is treated as command separator,
//    so the CLI only receives the FIRST line of the prompt.
// 2. claude-code CLI: "Continue the conversation" prefix triggers session-memory
//    check, which returns "I don't have prior context" (claude-code --print is a
//    fresh session, so it has no memory).
// 3. Trailing "Assistant:" / "AI:" makes Claude think it's mid-conversation
//    completion, refuses to start fresh.
//
// Returns { response, warnings, isHealthy, receivedPrompt } so tests can assert
// both that the prompt is shell-safe AND that the simulated agent accepted it.

/**
 * Simulate what an agent CLI does with a prompt.
 * @param {string} agentName - 'claude-code' | 'codex' | 'copilot' | 'opencode'
 * @param {string} rawPrompt - the prompt string constructed by buildContextualPrompt
 * @returns {{
 *   response: string,
 *   warnings: string[],
 *   isHealthy: boolean,
 *   receivedPrompt: string
 * }}
 */
export function simulateAgent(agentName, rawPrompt) {
    const warnings = [];
    const prompt = rawPrompt;

    // === Bug 2 (check first, before truncation, since the original raw prompt is what we wrote): ===
    // === "Continue the conversation" prefix triggers session-memory check ===
    if (/Continue the conversation/i.test(prompt)) {
        warnings.push(
            'FORMAT REFUSAL: "Continue the conversation" prefix triggers claude-code session-memory check. ' +
            'CLI returns "I don\'t have prior context"'
        );
        return {
            response: "I don't have prior context to continue from. What would you like me to do?",
            warnings,
            isHealthy: false,
            receivedPrompt: prompt,
        };
    }

    // === Bug 3: trailing Assistant: / AI: looks like mid-conversation completion ===
    const trimmed = prompt.trimEnd();
    if (/Assistant:\s*$/.test(trimmed) || /\bAI:\s*$/.test(trimmed)) {
        warnings.push(
            'FORMAT REFUSAL: trailing "Assistant:" or "AI:" makes Claude think it is mid-conversation completion. ' +
            'CLI refuses to start fresh.'
        );
        return {
            response: "I don't have prior context to continue from. What would you like me to do?",
            warnings,
            isHealthy: false,
            receivedPrompt: prompt,
        };
    }

    // === Bug 5: shell-special characters in user content (cmd.exe metachars) ===
    // When shell:true, cmd.exe interprets & | < > ^ as command separators/redirects.
    // User content like "give me a & b" gets split: cmd.exe runs "give me a" then "b".
    const SHELL_METACHARS = /[&|<>^]/;
    if (SHELL_METACHARS.test(prompt)) {
        const idx = prompt.search(SHELL_METACHARS);
        const offending = prompt[idx];
        warnings.push(
            `SHELL METACHAR LEAK: prompt contains "${offending}" at position ${idx}. ` +
            'cmd.exe with shell:true will interpret this as a command separator / redirect. ' +
            'CLI receives a truncated or malformed prompt.'
        );
        // Truncate at the metachar (simulating cmd.exe splitting)
        const truncated = prompt.slice(0, idx);
        return {
            response: `Your request was malformed (truncated at "${offending}"). Please rephrase.`,
            warnings,
            isHealthy: false,
            receivedPrompt: truncated,
        };
    }

    // === Bug 1: shell:true newline truncation ===
    // In production, we apply .replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    // BEFORE passing to spawn. If the prompt still has newlines at this point, it
    // means the production code forgot the transform.
    if (prompt.includes('\n') || prompt.includes('\r')) {
        const firstLine = prompt.split(/[\r\n]/)[0];
        warnings.push(
            `PROMPT TRUNCATED: prompt has newlines, cmd.exe + shell:true will only pass first line. ` +
            `CLI sees: "${firstLine.slice(0, 60)}${firstLine.length > 60 ? '...' : ''}"`
        );
        return {
            response: `Your message appears to be cut off after "${firstLine.slice(0, 30)}". Could you clarify what you'd like me to do?`,
            warnings,
            isHealthy: false,
            receivedPrompt: firstLine,
        };
    }

    // === Bug 4: agent name mismatch (cheap sanity check) ===
    const validAgents = ['claude-code', 'codex', 'copilot', 'opencode'];
    if (!validAgents.includes(agentName)) {
        warnings.push(`Unknown agent "${agentName}", simulation may be inaccurate`);
    }

    // === Healthy response ===
    // Extract the latest question for a more realistic fake response
    const latestMatch = prompt.match(/\[Latest question\]\s*\n?\s*([\s\S]+?)$/);
    const latestQuestion = latestMatch ? latestMatch[1].trim() : prompt.slice(-100);
    return {
        response: `[${agentName} simulated] I see your question: "${latestQuestion.slice(0, 80)}${latestQuestion.length > 80 ? '...' : ''}"`,
        warnings,
        isHealthy: true,
        receivedPrompt: prompt,
    };
}

/**
 * Build a prompt the same way production does, then apply shell-safe transform.
 * Convenience for tests: takes history + latest prompt, returns shell-safe prompt
 * ready for spawn.
 * @param {string} agentName
 * @param {string} latestPrompt
 * @param {Array<{role: string, content: string}>} history
 * @param {Function} buildContextualPromptFn - the agent's buildContextualPrompt function
 * @returns {string} shell-safe prompt (no newlines, single-spaced)
 */
export function buildShellSafePrompt(latestPrompt, history, buildContextualPromptFn) {
    const raw = buildContextualPromptFn(latestPrompt, history);
    return raw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}