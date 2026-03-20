import type { ContentConverterFn } from "./types.js";
export const convertShareCalendarEvent: ContentConverterFn = () => ({ content: "[calendar event]", resources: [] });
export const convertCalendar: ContentConverterFn = () => ({ content: "[calendar]", resources: [] });
export const convertGeneralCalendar: ContentConverterFn = () => ({ content: "[calendar]", resources: [] });
