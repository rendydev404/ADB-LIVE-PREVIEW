import {
    AndroidKeyCode,
    AndroidKeyEventAction,
    AndroidKeyEventMeta,
    AndroidMotionEventAction,
    ScrcpyPointerId,
    type ScrcpyControlMessageWriter,
} from "@yume-chan/scrcpy";

export interface VideoSize {
    width: number;
    height: number;
}

export async function pressKey(controller: ScrcpyControlMessageWriter, keyCode: AndroidKeyCode) {
    await controller.injectKeyCode({ action: AndroidKeyEventAction.Down, keyCode, repeat: 0, metaState: 0 });
    await controller.injectKeyCode({ action: AndroidKeyEventAction.Up, keyCode, repeat: 0, metaState: 0 });
}

function metaState(e: KeyboardEvent): AndroidKeyEventMeta {
    let state = 0;
    if (e.shiftKey) state |= AndroidKeyEventMeta.Shift;
    if (e.ctrlKey) state |= AndroidKeyEventMeta.Ctrl;
    if (e.altKey) state |= AndroidKeyEventMeta.Alt;
    if (e.metaKey) state |= AndroidKeyEventMeta.Meta;
    if (e.getModifierState("CapsLock")) state |= AndroidKeyEventMeta.CapsLock;
    return state as AndroidKeyEventMeta;
}

/**
 * Wires mouse/touch/pen, wheel and keyboard on `surface` to the device.
 * Left mouse = finger, right click = Back, middle click = Home, Ctrl+drag = pinch.
 */
export function attachInput(
    surface: HTMLElement,
    canvas: HTMLCanvasElement,
    getController: () => ScrcpyControlMessageWriter | undefined,
    getSize: () => VideoSize | undefined,
    onGesture: () => void,
) {
    const active = new Set<number>();
    let pinching = false;

    const position = (e: { clientX: number; clientY: number }, size: VideoSize) => {
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * size.width;
        const y = ((e.clientY - rect.top) / rect.height) * size.height;
        return {
            pointerX: Math.min(Math.max(x, 0), size.width),
            pointerY: Math.min(Math.max(y, 0), size.height),
            videoWidth: size.width,
            videoHeight: size.height,
        };
    };

    const touch = (e: PointerEvent, action: AndroidMotionEventAction) => {
        const controller = getController();
        const size = getSize();
        if (!controller || !size) return;
        const point = position(e, size);
        const pressure = action === AndroidMotionEventAction.Up ? 0 : e.pressure || 1;
        void controller.injectTouch({
            action,
            pointerId: BigInt(e.pointerId),
            ...point,
            pressure,
            actionButton: 0,
            buttons: 0,
        });
        if (pinching) {
            // Second finger mirrored around the center, like the emulator's Ctrl gesture.
            void controller.injectTouch({
                action,
                pointerId: ScrcpyPointerId.VirtualFinger,
                ...point,
                pointerX: size.width - point.pointerX,
                pointerY: size.height - point.pointerY,
                pressure,
                actionButton: 0,
                buttons: 0,
            });
        }
    };

    const onPointerDown = (e: PointerEvent) => {
        onGesture();
        surface.focus({ preventScroll: true });
        const controller = getController();
        if (!controller) return;
        if (e.pointerType === "mouse") {
            if (e.button === 2) {
                void pressKey(controller, AndroidKeyCode.AndroidBack);
                return;
            }
            if (e.button === 1) {
                void pressKey(controller, AndroidKeyCode.AndroidHome);
                return;
            }
            if (e.button !== 0) return;
            pinching = e.ctrlKey;
        }
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        active.add(e.pointerId);
        touch(e, AndroidMotionEventAction.Down);
    };

    const onPointerMove = (e: PointerEvent) => {
        if (!active.has(e.pointerId)) return;
        touch(e, AndroidMotionEventAction.Move);
    };

    const onPointerUp = (e: PointerEvent) => {
        if (!active.delete(e.pointerId)) return;
        touch(e, e.type === "pointercancel" ? AndroidMotionEventAction.Cancel : AndroidMotionEventAction.Up);
        pinching = false;
    };

    const onWheel = (e: WheelEvent) => {
        const controller = getController();
        const size = getSize();
        if (!controller || !size) return;
        e.preventDefault();
        const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 1 / 3 : 1 / 100;
        void controller.injectScroll({
            ...position(e, size),
            scrollX: Math.max(-1, Math.min(1, -e.deltaX * scale)),
            scrollY: Math.max(-1, Math.min(1, -e.deltaY * scale)),
            buttons: 0,
        });
    };

    const pressedKeys = new Map<string, AndroidKeyCode>();

    const onKeyDown = (e: KeyboardEvent) => {
        const controller = getController();
        if (!controller) return;
        onGesture();

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
            e.preventDefault();
            void navigator.clipboard
                .readText()
                .then((content) => controller.setClipboard({ content, paste: true, sequence: 0n }))
                .catch(() => {});
            return;
        }

        // Printable characters go through injectText so any keyboard layout / IME works.
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            void controller.injectText(e.key);
            return;
        }

        const keyCode = AndroidKeyCode[e.code as keyof typeof AndroidKeyCode];
        if (keyCode === undefined) return;
        e.preventDefault();
        pressedKeys.set(e.code, keyCode);
        void controller.injectKeyCode({
            action: AndroidKeyEventAction.Down,
            keyCode,
            repeat: e.repeat ? 1 : 0,
            metaState: metaState(e),
        });
    };

    const onKeyUp = (e: KeyboardEvent) => {
        const keyCode = pressedKeys.get(e.code);
        if (keyCode === undefined) return;
        pressedKeys.delete(e.code);
        e.preventDefault();
        void getController()?.injectKeyCode({
            action: AndroidKeyEventAction.Up,
            keyCode,
            repeat: 0,
            metaState: metaState(e),
        });
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    surface.addEventListener("keydown", onKeyDown);
    surface.addEventListener("keyup", onKeyUp);

    return () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("contextmenu", onContextMenu);
        surface.removeEventListener("keydown", onKeyDown);
        surface.removeEventListener("keyup", onKeyUp);
    };
}
