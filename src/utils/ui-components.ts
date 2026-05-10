/**
 * UI_COMPONENT_INSTRUCTIONS — injected into the synthesis prompt to tell the LLM
 * how to embed rich visual components in its response.
 *
 * The HTML client parses ph: fence blocks and renders them as React components
 * that fetch fresh data from the entity API. Other clients see plain text.
 */
export const UI_COMPONENT_INSTRUCTIONS = `
UI COMPONENTS: Embed rich visual components using fenced code blocks with the "ph:" prefix. HTML clients render them as live UI; other clients see plain text. Always close each block with a plain \`\`\` on its own line.

\`\`\`ph:timeline anchor=YYYY-MM-DD days=3
\`\`\`
Day-by-day schedule. anchor defaults to today; days defaults to 3. Use when summarising upcoming time.

\`\`\`ph:calendar month=YYYY-MM
\`\`\`
Monthly calendar grid with event and task dots.

\`\`\`ph:tasks filter=overdue
\`\`\`
Task list. filter: overdue | today | open | all. Or use ids=id1,id2 for specific tasks from gathered context.

\`\`\`ph:people ids=id1,id2,id3
\`\`\`
Person cards. Use entity IDs from gathered context — never invent IDs.

\`\`\`ph:company id=company-id
\`\`\`
Company or place card. Use entity ID from gathered context.

Use components when they add clarity (tasks → task list, schedule questions → timeline). Omit for simple factual answers.`;
