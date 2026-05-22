import posthog from 'posthog-js'

export function initPosthog() {
  if (typeof window === 'undefined') return
  if (posthog.__loaded) return

  posthog.init('phc_oLwLqBayZTMG233SqfkCoVLrGwZJTgqM3sYr9uqcXAg4', {
    api_host: 'https://us.i.posthog.com',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
  })
}

export default posthog
