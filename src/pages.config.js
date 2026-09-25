/**
 * The app's pages. Each key is both the route (/Focus) and the name the
 * Layout highlights; mainPage is what "/" shows.
 *
 * base44 generated this file and said not to edit it; that generator is gone,
 * so it is maintained by hand now. Add a page by importing it and listing it.
 */
import Today from './pages/Today';
import Focus from './pages/Focus';
import Study from './pages/Study';
import Classes from './pages/Classes';
import Settings from './pages/Settings';
import __Layout from './Layout.jsx';

export const PAGES = {
    "Today": Today,
    "Focus": Focus,
    "Study": Study,
    "Classes": Classes,
    "Settings": Settings,
}

export const pagesConfig = {
    mainPage: "Today",
    Pages: PAGES,
    Layout: __Layout,
};
