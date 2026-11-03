// Inline stroke icons (24x24 grid) — no icon font or extra request.
const PATHS = {
    back: "M15 6l-6 6 6 6",
    home: "M4 11l8-7 8 7M6 10v10h12V10",
    recents: "M6 6h12v12H6z",
    power: "M12 3v9M7.5 6.5a7 7 0 1 0 9 0",
    volup: "M4 10v4h4l5 4V6L8 10H4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12",
    voldown: "M4 10v4h4l5 4V6L8 10H4zM16 9a4 4 0 0 1 0 6",
    rotate: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
    bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
    camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    record: "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",
    screen: "M7 3h10v18H7zM10 18h4",
    sound: "M4 10v4h4l5 4V6L8 10H4zM16 9a4 4 0 0 1 0 6",
    muted: "M4 10v4h4l5 4V6L8 10H4zM16 9l5 6M21 9l-5 6",
    stats: "M5 20V10M12 20V4M19 20v-7",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.3-1.3L17 5l-3-1-1 2h-2L10 4 7 5l.3 2L6 8.3 4 8l-1 3 2 1v1l-2 1 1 3 2-.3 1.3 1.3L7 19l3 1 1-2h2l1 2 3-1-.3-2 1.3-1.3 2 .3 1-3-2-1z",
    fullscreen: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
    usb: "M12 3v14M9 6l3-3 3 3M8 11v2l4 3 4-3v-3M12 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
    phone: "M7 3h10v18H7zM11 18h2",
    folder: "M3 6h6l2 2h10v11H3z",
    file: "M6 3h8l4 4v14H6zM14 3v4h4",
    up: "M12 19V5M6 11l6-6 6 6",
    refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
    upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
    download: "M12 4v12M7 11l5 5 5-5M4 20h16",
    trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
    plus: "M12 5v14M5 12h14",
    pause: "M8 5v14M16 5v14",
    play: "M7 5l12 7-12 7z",
    clear: "M5 5l14 14M19 5L5 19",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
    edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
    launch: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
    stop: "M6 6h12v12H6z",
    book: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6",
    wrap: "M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; size?: number }) {
    return (
        <svg
            class="icon"
            width={props.size ?? 18}
            height={props.size ?? 18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d={PATHS[props.name]} />
        </svg>
    );
}
