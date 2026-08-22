declare type DndEvent = import("svelte-dnd-action").DndEvent;

/** Exposed to the renderer by the preload script. */
declare interface Window {
    api: import("common/WindowApi").default;
}

declare namespace svelte.JSX {
    interface HTMLAttributes<T> {
        onconsider?: (event: CustomEvent<DndEvent> & {target: EventTarget & T}) => void;
        onfinalize?: (event: CustomEvent<DndEvent> & {target: EventTarget & T}) => void;
    }
}

/** The short git commit the bundle was built from. Injected by webpack. */
declare const __GIT_COMMIT__: string;
/** When the bundle was built, as an ISO string. Injected by webpack. */
declare const __BUILD_DATE__: string;
