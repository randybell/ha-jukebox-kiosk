/** #143: replaced at build time by rollup.config.mjs: false in the shipped card (so the window.__jb* test hooks and their
 *  names are dropped from it), true only in the e2e build (JB_TEST_HOOKS=1, test/hooks-build.mjs). */
declare const __JB_TEST_HOOKS__: boolean | undefined;
export const TEST_HOOKS: boolean = typeof __JB_TEST_HOOKS__ !== 'undefined' && !!__JB_TEST_HOOKS__;
