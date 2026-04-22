// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — System Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
//
// Pre-configured CatalogNodes for local CLI commands (macOS-friendly).
// Each node binds cli_command with a specific command and context_path.
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_COMMANDS = [
    {
        key: 'get_time',
        name: 'Get Current Time',
        description: 'Returns the current local date and time.',
        command: 'date "+%A, %B %d, %Y %I:%M:%S %p %Z"',
        contextPath: 'current_time',
    },
    {
        key: 'get_date',
        name: 'Get Current Date',
        description: 'Returns today\'s date in ISO format.',
        command: 'date "+%Y-%m-%d"',
        contextPath: 'current_date',
    },
    {
        key: 'get_hostname',
        name: 'Get Hostname',
        description: 'Returns the machine hostname.',
        command: 'hostname',
        contextPath: 'hostname',
    },
    {
        key: 'get_uptime',
        name: 'Get Uptime',
        description: 'Returns system uptime.',
        command: 'uptime',
        contextPath: 'uptime',
    },
    {
        key: 'get_disk_usage',
        name: 'Get Disk Usage',
        description: 'Returns root partition disk usage.',
        command: 'df -h / | tail -1',
        contextPath: 'disk_usage',
    },
    {
        key: 'get_user',
        name: 'Get Current User',
        description: 'Returns the current username.',
        command: 'whoami',
        contextPath: 'current_user',
    },
    {
        key: 'get_calendar',
        name: 'Get Calendar',
        description: 'Returns the current month calendar.',
        command: 'cal',
        contextPath: 'calendar',
    },
];
export class SystemCatalogSource {
    getCatalogNodes() {
        return SYSTEM_COMMANDS.map(cmd => ({
            key: cmd.key,
            nodeCodeKey: 'cli_command',
            name: cmd.name,
            group: 'system',
            description: cmd.description,
            configuration: {
                command: cmd.command,
                context_path: cmd.contextPath,
            },
        }));
    }
}
