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