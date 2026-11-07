import { isNativeApp } from './native.js';

/** The Code A Difference home page. LOCK IN! is served from /lockin/ inside it, so '/' is it, on the web. */
export const SITE_URL = import.meta.env.VITE_SITE_URL || '/';

/**
 * The feedback form on the Code A Difference home page. Inside the phone app '/' would be the app's own
 * page, so there the link is only offered when the build knows the real address of the site.
 */
export const FEEDBACK_URL = (!isNativeApp || import.meta.env.VITE_SITE_URL) ? `${SITE_URL.replace(/\/$/, '')}/#feedback` : '';
