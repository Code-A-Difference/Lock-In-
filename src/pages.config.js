import { lazy } from 'react';
/**
 * The app's pages. Each key is both the route (/Focus) and the name the
 * Layout highlights; mainPage is what "/" shows.
 *
 * base44 generated this file and said not to edit it; that generator is gone,
 * so it is maintained by hand now. Add a page by importing it and listing it.
 */
const Today = lazy(() => import('./pages/Today'));
const Focus = lazy(() => import('./pages/Focus'));
const Study = lazy(() => import('./pages/Study'));
const Classes = lazy(() => import('./pages/Classes'));
const Notes = lazy(() => import('./pages/Notes'));
const Settings = lazy(() => import('./pages/Settings'));
const Progress = lazy(() => import('./pages/Progress'));
import __Layout from './Layout.jsx';

export const PAGES = {
    "Today": Today,
    "Focus": Focus,
    "Study": Study,
    "Notes": Notes,
    "Classes": Classes,
    "Settings": Settings,
    "Progress": Progress,
}

export const pagesConfig = {
    mainPage: "Today",
    Pages: PAGES,
    Layout: __Layout,
};
