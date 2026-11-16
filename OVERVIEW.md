Grill-Me adds an interactive `/grill-me` design interview workflow to Paseo chat sessions. When you run `/grill-me` (with an optional topic or against the current conversation), the plugin prompts the agent to walk through your task one decision at a time until you reach a shared understanding.

## How it works

The plugin attaches a `paseo_ask_question` tool to interactive agent sessions. When the agent's turn ends with a question waiting, the plugin adds a question card as the last row of the chat, right above the composer. The card shows the design branch label, multiple-choice options (with the recommended option marked), an "Other" custom answer field, and an optional note field. In the agent's tool activity, the tool call itself becomes a one-line "Asked" entry that later shows the outcome.

Submitting the card sends your answer to the agent as the next user turn and locks the card: it keeps every option visible, marks your choices, and shows an "Answered" badge. If you reply by typing in the chat composer instead, the card locks and quotes your reply. If the agent asks a newer question before you answer, the older card locks as skipped. When the daemon restarts, cards for unanswered questions come back the next time the agent loads.

When any non-archived agent in a workspace has an unanswered question, a "Question" badge appears on that workspace row in the sidebar. This badge only appears on Paseo apps that support workspace row badges (not 0.15.4).

## Requirements and storage

Requires Paseo 0.15.4 or later.

Question and answer state is stored by the plugin on the daemon machine in `<Paseo home>/plugin-data/paseo-grill-me/state.json`. It survives daemon restarts and is removed when an agent is archived.

## Settings

Host-scoped settings are available under **Settings > Plugins > Grill-Me**:

- **Show sidebar workspace badge**: Toggle the "Question" badge on workspace rows when an agent is waiting for an answer.
- **Prompt template**: Customize the base instructions sent when `/grill-me` starts an interview.
- **Additional custom instructions**: Append extra guidance after the prompt template without replacing the template.
- **Raw prompt preview**: View and copy the exact prompt text that `/grill-me` sends to the agent.
- **Reset to defaults**: Restore the default prompt template, custom instructions, and badge setting.
