
import { useRef, useCallback } from 'react';

interface HistoryState<T> {
    past: T[];
    future: T[];
}

export const useHistory = <T>() => {
    const historyRef = useRef<HistoryState<T>>({ past: [], future: [] });

    const push = useCallback((currentState: T) => {
        historyRef.current.past.push(currentState);
        historyRef.current.future = [];
        // Limit history size to prevent memory issues
        if (historyRef.current.past.length > 50) {
            historyRef.current.past.shift();
        }
    }, []);

    const undo = useCallback((currentState: T): T | null => {
        if (historyRef.current.past.length === 0) return null;
        
        const previous = historyRef.current.past.pop();
        if (previous) {
            historyRef.current.future.push(currentState);
            return previous;
        }
        return null;
    }, []);

    const redo = useCallback((currentState: T): T | null => {
        if (historyRef.current.future.length === 0) return null;

        const next = historyRef.current.future.pop();
        if (next) {
            historyRef.current.past.push(currentState);
            return next;
        }
        return null;
    }, []);

    const clear = useCallback(() => {
        historyRef.current = { past: [], future: [] };
    }, []);

    return {
        push,
        undo,
        redo,
        clear
    };
};
