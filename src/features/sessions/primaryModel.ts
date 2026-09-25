// The session's main model, so cards can flag messages (and sub-agents) that ran on a different one.
import { createContext, useContext } from 'react';

export const PrimaryModelContext = createContext<string | null>(null);
export const usePrimaryModel = () => useContext(PrimaryModelContext);
