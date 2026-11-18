'use client';

import { useEffect } from 'react';

/** Keeps the system wait cursor on until `active` becomes false or the component unmounts. */
export function useWaitCursor(active: boolean) {
    useEffect(() => {
        if (!active || typeof document === 'undefined') return;
        const prevHtml = document.documentElement.style.cursor;
        const prevBody = document.body.style.cursor;
        document.documentElement.style.cursor = 'wait';
        document.body.style.cursor = 'wait';
        return () => {
            document.documentElement.style.cursor = prevHtml;
            document.body.style.cursor = prevBody;
        };
    }, [active]);
}