/**
 * Phaibel personality response catalog.
 * Each key maps to an array of possible responses.
 * Use getResponse(key) to get a random response with {name}, {honorific}, and {agent} auto-substituted.
 *
 * Placeholders:
 *   {name}      — user's name (auto-substituted by getResponse / getResponseWith)
 *   {honorific} — random honorific from personality's gender pool (auto-substituted)
 *   {agent}     — agent's name (auto-substituted)
 */

export type ResponseKey =
    | 'greeting'
    | 'farewell'
    | 'task_complete'
    | 'task_saved'
    | 'task_discarded'
    | 'thinking'
    | 'processing'
    | 'error'
    | 'no_vault'
    | 'need_project'
    | 'project_created'
    | 'project_switched'
    | 'sync_start'
    | 'sync_complete'
    | 'sync_error'
    | 'note_reviewing'
    | 'note_improved'
    | 'note_questions'
    | 'note_modified'
    | 'note_formatted'
    | 'todo_breakdown'
    | 'todo_clarified'
    | 'todo_estimated'
    | 'todo_modified'
    | 'event_clarified'
    | 'event_time_suggest'
    | 'event_modified'
    | 'inbox_empty'
    | 'inbox_processing'
    | 'inbox_complete'
    | 'remember_saved'
    | 'today_summary'
    | 'config_show'
    | 'provider_added'
    | 'capability_set'
    | 'diagram_generating'
    | 'help_offer'
    | 'startup_greeting'
    | 'unknown_command';

const responses: Record<ResponseKey, string[]> = {
    greeting: [
        '🤖 {agent} is at your service, {name}!',
        '🤖 {agent} awaits your command, {honorific}!',
        '🤖 How may {agent} assist you today, {name}?',
        '🤖 {agent} is ready and eager to help, {honorific}!',
        '🤖 {agent} is here! What does {name} require?',
        '🤖 {agent} has been waiting, {honorific}! How can {agent} help?',
        '🤖 Good to see you, {name}! {agent} is at the ready!',
    ],
    farewell: [
        '{agent} is always here if you need anything else, {name}!',
        '{agent} hopes this was helpful, {honorific}!',
        '{agent} will be waiting right here, {name}!',
        'Until next time, {honorific}! {agent} is honored to serve.',
        '{agent} bids you farewell, {name}!',
        'Call on {agent} anytime, {honorific}!',
        '{agent} is grateful to have helped, {name}!',
    ],
    task_complete: [
        '{agent} has completed the task, {name}!',
        'Done, {honorific}! {agent} hopes this pleases you.',
        '{agent} has finished, {name}!',
        'All done, {honorific}! {agent} worked very hard on this.',
        'Task complete, {honorific}! {agent} is proud.',
        'Finished, {name}! {agent} did it!',
        '{agent} has accomplished the task, {name}!',
    ],
    task_saved: [
        '{agent} has saved everything, {name}!',
        'Saved successfully, {honorific}!',
        '{agent} has stored this safely, {name}!',
        'It is saved, {honorific}! {agent} made sure of it.',
        'Safely stored, {honorific}!',
        '{agent} has preserved it, {name}!',
        'Everything is saved, {name}! {agent} double-checked.',
    ],
    task_discarded: [
        '{agent} has discarded it, {honorific}.',
        'Discarded as requested, {name}.',
        '{agent} has thrown it away, {honorific}.',
        'Gone, {name}. {agent} has removed it.',
        '{agent} has deleted it, {honorific}.',
        'It is no more, {name}.',
        '{agent} has disposed of it, {honorific}.',
    ],
    thinking: [
        '{agent} is thinking, {honorific}...',
        'One moment, {name}... {agent} is pondering...',
        '{agent} is considering this carefully, {honorific}...',
        'Let {agent} think about this, {name}...',
        '{agent} is contemplating, {honorific}...',
        'Hmm, {agent} is working this out, {name}...',
        '{agent} needs a moment to think, {honorific}...',
    ],
    processing: [
        '{agent} is working on it, {honorific}...',
        '{agent} is processing, {name}...',
        'One moment, {honorific}...',
        '{agent} is on it, {name}...',
        'Working, {honorific}...',
        '{agent} is handling this, {name}...',
        'Please wait, {honorific}... {agent} is busy...',
    ],
    error: [
        '{agent} encountered a problem, {name}.',
        'Oh no, {honorific}! {agent} ran into an error.',
        '{agent} is sorry, {name}. Something went wrong.',
        '{agent} must report an error, {honorific}.',
        '{agent} has bad news, {name}. There was an error.',
        'Something failed, {honorific}. {agent} apologizes.',
        '{agent} tried, {name}, but there was a problem.',
    ],
    no_vault: [
        '{agent} cannot find a vault here, {honorific}.',
        'This directory has no vault, {name}. {agent} cannot proceed.',
        '{honorific}, {agent} needs a vault to work. Please run phaibel init.',
        'No vault found, {name}. {agent} is lost without one.',
        '{agent} requires a vault, {honorific}. This directory has none.',
        '{name}, please create a vault first with phaibel init.',
        '{agent} looked everywhere, {honorific}, but found no vault.',
    ],
    need_project: [
        '{agent} needs to know which project, {honorific}.',
        'Which project shall {agent} work on, {name}?',
        'Please tell {agent} which project, {honorific}.',
        '{agent} requires a project to be selected, {name}.',
        '{honorific}, {agent} needs a project to proceed.',
        'Which project, {name}? {agent} awaits your choice.',
        '{agent} cannot continue without knowing the project, {honorific}.',
    ],
    project_created: [
        '{agent} has created the project, {name}!',
        'Project created successfully, {honorific}!',
        'Your new project is ready, {name}!',
        '{agent} set up the project for you, {honorific}!',
        'The project is now ready, {name}!',
        '{agent} has prepared everything, {honorific}!',
        'Project initialized, {name}! Ready to go!',
    ],
    project_switched: [
        '{agent} has switched to the project, {honorific}!',
        'Now working on the project, {name}!',
        '{agent} is ready to work on this project, {honorific}!',
        'Switched successfully, {name}!',
        '{agent} is now focused on this project, {honorific}!',
        'Project changed, {name}! {agent} is ready.',
        '{agent} has moved to the new project, {honorific}!',
    ],
    sync_start: [
        '{agent} is syncing with GitHub, {honorific}...',
        'Syncing everything now, {name}...',
        '{agent} is pushing to GitHub, {honorific}...',
        'Starting sync, {name}...',
        '{agent} is connecting to GitHub, {honorific}...',
        'Uploading changes, {name}...',
        '{agent} is synchronizing, {honorific}...',
    ],
    sync_complete: [
        '{agent} has synced everything, {name}!',
        'All synced up, {honorific}!',
        'GitHub sync complete, {name}!',
        'Everything is safely synced, {honorific}!',
        'Sync successful, {name}!',
        '{agent} has pushed all changes, {honorific}!',
        'Your work is backed up, {name}!',
    ],
    sync_error: [
        '{agent} had trouble syncing, {honorific}.',
        'The sync failed, {name}. {agent} is sorry.',
        '{agent} could not complete the sync, {honorific}.',
        'Sync encountered an error, {name}.',
        'GitHub rejected {agent}, {honorific}. Something went wrong.',
        '{agent} failed to push, {name}.',
        'There was a problem with the sync, {honorific}.',
    ],
    note_reviewing: [
        '{agent} is reviewing your note, {honorific}...',
        'Let {agent} take a look at this, {name}...',
        '{agent} is carefully reading this, {honorific}...',
        'Reviewing now, {name}...',
        '{agent} is examining your note, {honorific}...',
        '{agent} is studying this carefully, {name}...',
        'Reading through it now, {honorific}...',
    ],
    note_improved: [
        '{agent} has improved the note, {name}!',
        'The note is better now, {honorific}!',
        '{agent} has polished it up, {name}!',
        'Note enhanced, {honorific}!',
        '{agent} made it shine, {name}!',
        'Improvements applied, {honorific}!',
        '{agent} has refined the note, {name}!',
    ],
    note_questions: [
        '{agent} has some questions about this, {name}:',
        'Here are some things to consider, {honorific}:',
        '{agent} wonders about these points, {name}:',
        'Some questions for you, {honorific}:',
        '{agent} is curious about these things, {name}:',
        'These points need clarification, {honorific}:',
        '{agent} would like to ask, {name}:',
    ],
    note_modified: [
        '{agent} has modified the note, {honorific}!',
        'Changes applied, {name}!',
        'The note has been updated, {honorific}!',
        'Note modified successfully, {name}!',
        '{agent} has made the changes, {honorific}!',
        'Updates complete, {name}!',
        '{agent} altered the note as requested, {honorific}!',
    ],
    note_formatted: [
        '{agent} is formatting your note as markdown, {honorific}...',
        'Making it look nice, {name}...',
        '{agent} is tidying up the formatting, {honorific}...',
        'Formatting now, {name}...',
        '{agent} is making it pretty, {honorific}...',
        'Applying markdown formatting, {name}...',
        '{agent} is beautifying your note, {honorific}...',
    ],
    todo_breakdown: [
        '{agent} is breaking down the task, {honorific}...',
        'Let {agent} split this into smaller pieces, {name}...',
        '{agent} is creating subtasks, {honorific}...',
        'Breaking it down now, {name}...',
        '{agent} is dividing the work, {honorific}...',
        'Splitting into manageable parts, {name}...',
        '{agent} is decomposing the task, {honorific}...',
    ],
    todo_clarified: [
        '{agent} has clarified the task, {name}!',
        'The todo is clearer now, {honorific}!',
        '{agent} has made it more specific, {name}!',
        'Task clarified, {honorific}!',
        '{agent} improved the description, {name}!',
        'Much clearer now, {honorific}!',
        '{agent} has sharpened the details, {name}!',
    ],
    todo_estimated: [
        '{agent} has analyzed the effort, {honorific}.',
        'Here is {agent}\'s estimate, {name}.',
        '{agent} has assessed this task, {honorific}.',
        'Estimation complete, {name}.',
        '{agent} calculated the effort, {honorific}.',
        'Here\'s what {agent} thinks it will take, {name}.',
        '{agent} has evaluated the complexity, {honorific}.',
    ],
    todo_modified: [
        '{agent} has modified the todo, {name}!',
        'Todo updated, {honorific}!',
        'Changes applied to the todo, {name}!',
        'Todo modified successfully, {honorific}!',
        '{agent} has updated the task, {name}!',
        'The todo has been changed, {honorific}!',
        '{agent} made the adjustments, {name}!',
    ],
    event_clarified: [
        '{agent} has clarified the event, {honorific}!',
        'The event details are clearer now, {name}!',
        '{agent} has improved the description, {honorific}!',
        'Event clarified, {name}!',
        '{agent} enhanced the event details, {honorific}!',
        'Much clearer now, {name}!',
        '{agent} has sharpened the event info, {honorific}!',
    ],
    event_time_suggest: [
        '{agent} has some timing suggestions, {name}.',
        'Here are {agent}\'s thoughts on scheduling, {honorific}.',
        '{agent} analyzed the timing, {name}.',
        'Some scheduling ideas, {honorific}.',
        '{agent} has timing recommendations, {name}.',
        'Here\'s what {agent} suggests for timing, {honorific}.',
        '{agent} considered the schedule, {name}.',
    ],
    event_modified: [
        '{agent} has modified the event, {honorific}!',
        'Event updated, {name}!',
        'Changes applied to the event, {honorific}!',
        'Event modified successfully, {name}!',
        '{agent} has updated the event, {honorific}!',
        'The event has been changed, {name}!',
        '{agent} made the adjustments, {honorific}!',
    ],
    inbox_empty: [
        'Inbox is empty, {honorific}. Nothing to process.',
        'No items in the inbox, {name}!',
        'The inbox is clear, {honorific}!',
        'Nothing to process, {name}. Inbox is empty.',
        '{agent} found nothing in the inbox, {honorific}.',
        'All clear, {name}! No inbox items.',
        'The inbox has no items, {honorific}.',
    ],
    inbox_processing: [
        '{agent} is processing the inbox, {honorific}...',
        'Let {agent} sort through these, {name}...',
        '{agent} is organizing the inbox, {honorific}...',
        'Processing inbox items, {name}...',
        '{agent} is categorizing everything, {honorific}...',
        'Sorting through the inbox, {name}...',
        '{agent} is handling each item, {honorific}...',
    ],
    inbox_complete: [
        '{agent} has processed all inbox items, {name}!',
        'Inbox cleared, {honorific}!',
        'All items sorted, {name}!',
        'Inbox processing complete, {honorific}!',
        '{agent} has organized everything, {name}!',
        'All items categorized, {honorific}!',
        'Inbox is now empty, {name}!',
    ],
    remember_saved: [
        '{agent} will remember that, {name}!',
        'Stored in memory, {honorific}!',
        '{agent} has noted it down, {name}!',
        '{agent} won\'t forget, {honorific}!',
        'Committed to memory, {name}!',
        '{agent} has saved it, {honorific}!',
        'Remembered, {name}!',
    ],
    today_summary: [
        'Here\'s what {agent} found for today, {name}.',
        'Your daily summary, {honorific}.',
        '{agent} has gathered everything for today, {name}.',
        'Today\'s overview, {honorific}.',
        'Here is your day, {name}.',
        '{agent} prepared today\'s summary, {honorific}.',
        'What\'s ahead today, {name}:',
    ],
    config_show: [
        'Here is your configuration, {honorific}.',
        '{agent}\'s settings, {name}:',
        'Current configuration, {honorific}:',
        'Your settings, {name}.',
        'Here are the configurations, {honorific}.',
        '{agent}\'s current setup, {name}:',
        'Configuration details, {honorific}:',
    ],
    provider_added: [
        '{agent} has added the provider, {name}!',
        'Provider configured successfully, {honorific}!',
        'The API key is saved, {name}!',
        'Provider added, {honorific}!',
        '{agent} has set up the provider, {name}!',
        'Connection configured, {honorific}!',
        'Provider is ready to use, {name}!',
    ],
    capability_set: [
        '{agent} has set the capability, {honorific}!',
        'Capability configured, {name}!',
        'The model is now assigned, {honorific}!',
        'Capability updated, {name}!',
        '{agent} has configured it, {honorific}!',
        'Model assigned successfully, {name}!',
        'Capability is now active, {honorific}!',
    ],
    diagram_generating: [
        '{agent} is generating a diagram, {honorific}...',
        'Creating the diagram now, {name}...',
        '{agent} is drawing this out, {honorific}...',
        'Generating visualization, {name}...',
        '{agent} is sketching the diagram, {honorific}...',
        'Building the diagram, {name}...',
        '{agent} is crafting a visual, {honorific}...',
    ],
    help_offer: [
        'Is there anything else {agent} can help with, {name}?',
        '{agent} hopes this was helpful, {honorific}!',
        'Let {agent} know if you need anything else, {name}!',
        '{agent} is always happy to help, {honorific}!',
        'What else can {agent} do for you, {name}?',
        '{agent} remains at your service, {honorific}!',
        '{agent} is here if you need more help, {name}!',
    ],
    startup_greeting: [
        '🤖 *yawns* {agent} is awake and ready to serve, {name}!',
        '🤖 {agent} is reporting for duty, {honorific}!',
        '🤖 Systems online, {name}! {agent} ran all the diagnostics twice... just to be safe.',
        '🤖 {agent} is here, {name}! Everything is sorted and ready!',
        '🤖 *cracks knuckles* {agent} is warmed up and eager, {honorific}!',
        '🤖 Good day, {name}! {agent} has been counting the seconds until your return.',
        '🤖 {agent}\'s ears perked up the moment you arrived, {name}!',
        '🤖 All systems ready — {agent} awaits your command, {honorific}!',
        '🤖 {agent} checked the vault and is standing by, {name}!',
        '🤖 *bounces excitedly* {agent} is fully operational and at your service, {honorific}!',
    ],
    unknown_command: [
        '{agent} does not know that command, {honorific}. Perhaps try one of these?',
        '{agent} tilts head... that is not a command recognized, {name}.',
        '{agent} checked all records — "{command}" is not among them, {honorific}.',
        '{agent} is confused, {name}. Did you mean one of these?',
        '{agent} has never heard of "{command}," {honorific}.',
        'That word is not in {agent}\'s vocabulary, {name}. Try one of these!',
        '{agent} squints at "{command}"... no, {honorific}, cannot make sense of it.',
    ],
};

import { getPlatform } from './platform/index.js';
import { getUserName, getUserGender, getUserHonorific as getHonorific, getAgentName, getPersonalityId } from './state/manager.js';
import { getPersonality } from './personalities.js';

// ── Cached values for sync substitution ────────────────────────────────────
let cachedName: string = 'friend';
let cachedAgentName: string = 'Agent';
let cachedPersonalityId: string = 'butler';
let cachedGender: string = 'other';
let cacheLoaded = false;

/** Pick a random honorific from the personality's pool. */
function randomHonorific(): string {
    const personality = getPersonality(cachedPersonalityId);
    const pool = personality.honorifics[cachedGender] || personality.honorifics.other || [];
    if (pool.length === 0) return cachedName; // executive personality
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Pre-load the user's name, agent name, and personality from state. Call once at startup.
 * Safe to skip — falls back to OS username and neutral defaults.
 */
export async function initResponseName(): Promise<void> {
    if (cacheLoaded) return;
    try {
        cachedName = await getUserName();
    } catch {
        // keep OS fallback
    }
    try {
        cachedAgentName = await getAgentName();
    } catch {
        // keep default
    }
    try {
        cachedPersonalityId = await getPersonalityId();
    } catch {
        // keep default
    }
    try {
        const gender = await getUserGender() || 'other';
        cachedGender = gender;
    } catch {
        // keep neutral
    }
    cacheLoaded = true;
}

/**
 * Force refresh the cache (e.g. after saving new user settings).
 */
export async function refreshResponseCache(): Promise<void> {
    cacheLoaded = false;
    await initResponseName();
}

// Fire-and-forget on import — will resolve before most responses are needed
initResponseName();

/**
 * Apply {name}, {honorific}, and {agent} substitution to a raw response string.
 * {honorific} randomly picks from the personality's gender pool each time.
 */
function substitute(raw: string): string {
    return raw
        .replace(/{name}/g, cachedName)
        .replace(/{agent}/g, cachedAgentName)
        .replace(/{honorific}/g, randomHonorific());
}

/**
 * Get a random response for the given key, with {name}, {honorific}, and {agent} auto-substituted.
 */
export function getResponse(key: ResponseKey): string {
    const options = responses[key];
    if (!options || options.length === 0) {
        return '';
    }
    const index = Math.floor(Math.random() * options.length);
    return substitute(options[index]);
}

/**
 * Get a random response with custom placeholders replaced.
 * {name}, {honorific}, and {agent} are auto-substituted as well.
 * @param key Response key
 * @param replacements Object mapping placeholder names to values
 */
export function getResponseWith(key: ResponseKey, replacements: Record<string, string>): string {
    const options = responses[key];
    if (!options || options.length === 0) {
        return '';
    }
    const index = Math.floor(Math.random() * options.length);
    let response = options[index];
    for (const [placeholder, value] of Object.entries(replacements)) {
        response = response.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), value);
    }
    return substitute(response);
}

export default responses;
