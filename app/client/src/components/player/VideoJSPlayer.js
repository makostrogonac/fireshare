import React, { useEffect, useRef, useState, useMemo } from 'react'
import '@videojs/react/video/skin.css'
import './videoSkinOverrides.css'
import { createPlayer, useMedia, Poster } from '@videojs/react'
import { Video, videoFeatures } from '@videojs/react/video'
import CustomVideoSkin from './CustomVideoSkin'

// Tolerance threshold for checking if player is already at the desired start time (in seconds)
const SEEK_TOLERANCE_SECONDS = 0.5

// How long to wait while buffering before switching to a lower quality source (in ms)
const BUFFER_STALL_TIMEOUT_MS = 5000

// Number of buffering events within the window that triggers a quality downgrade
const BUFFER_COUNT_THRESHOLD = 4

// Sliding window duration for counting buffering events (in ms)
const BUFFER_COUNT_WINDOW_MS = 30000

// Create the Video.js 10 player instance (module-level singleton)
const Player = createPlayer({ features: videoFeatures })

function PlayerEffects({ sources, onSourceChange, onTimeUpdate, onReady, startTime, forceMuted = false }) {
  const store = Player.usePlayer()
  const media = Player.useMedia()
  const currentTime = Player.usePlayer((s) => s.currentTime)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onReadyRef = useRef(onReady)
  const startTimeApplied = useRef(false)
  const readyFired = useRef(false)
  const forcedMuteStateRef = useRef(null)

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate
    onReadyRef.current = onReady
  }, [onTimeUpdate, onReady])

  useEffect(() => {
    if (onTimeUpdateRef.current) {
      onTimeUpdateRef.current({ playedSeconds: currentTime || 0 })
    }
  }, [currentTime])

  // --- onReady: provide a wrapper that mimics the v8 player API --------------
  const mediaRef = useRef(null)
  useEffect(() => {
    mediaRef.current = media
  }, [media])

  const playerWrapper = useMemo(
    () => ({
      currentTime: () => mediaRef.current?.currentTime ?? 0,
      duration: () => mediaRef.current?.duration ?? 0,
      paused: () => mediaRef.current?.paused ?? true,
      play: () => store.play?.(),
      pause: () => store.pause?.(),
      seek: (time) => {
        if (mediaRef.current) mediaRef.current.currentTime = time
      },
      el: () => mediaRef.current,
    }),
    [store],
  )

  useEffect(() => {
    if (media && !readyFired.current) {
      readyFired.current = true
      if (onReadyRef.current) {
        onReadyRef.current(playerWrapper)
      }
    }
  }, [media, playerWrapper])

  // --- forceMuted: used by the editor audio preview to prevent doubled audio --
  useEffect(() => {
    if (!media) return undefined

    const restoreOriginalVolume = () => {
      if (!forcedMuteStateRef.current) return
      media.muted = forcedMuteStateRef.current.muted
      media.volume = forcedMuteStateRef.current.volume
      forcedMuteStateRef.current = null
    }

    if (!forceMuted) {
      restoreOriginalVolume()
      return undefined
    }

    if (!forcedMuteStateRef.current) {
      forcedMuteStateRef.current = { muted: media.muted, volume: media.volume }
    }

    let applying = false
    const enforceMute = () => {
      if (applying) return
      if (!media.muted || media.volume !== 0) {
        applying = true
        media.muted = true
        media.volume = 0
        applying = false
      }
    }

    enforceMute()
    media.addEventListener('volumechange', enforceMute)

    return () => {
      media.removeEventListener('volumechange', enforceMute)
      restoreOriginalVolume()
    }
  }, [media, forceMuted])

  // --- startTime: seek to the requested position once the player is ready ----
  useEffect(() => {
    if (!media || !startTime || startTimeApplied.current) return

    const applySeek = () => {
      if (media.duration > 0) {
        const pct = startTime / media.duration
        if (startTime < 10 || pct > 0.9) {
          startTimeApplied.current = true
          return
        }
      }
      media.currentTime = startTime
      startTimeApplied.current = true
    }

    const handleCanPlay = () => {
      if (!startTimeApplied.current) applySeek()
    }

    const handleLoaded = () => {
      if (!startTimeApplied.current) applySeek()
    }

    if (media.readyState >= 1) {
      applySeek()
    } else {
      media.addEventListener('loadedmetadata', handleLoaded, { once: true })
    }
    media.addEventListener('canplay', handleCanPlay, { once: true })

    const handlePlay = () => {
      if (!startTimeApplied.current || Math.abs(media.currentTime - startTime) > SEEK_TOLERANCE_SECONDS) {
        applySeek()
      }
    }
    media.addEventListener('play', handlePlay, { once: true })

    return () => {
      media.removeEventListener('loadedmetadata', handleLoaded)
      media.removeEventListener('canplay', handleCanPlay)
      media.removeEventListener('play', handlePlay)
    }
  }, [media, startTime])

  // --- Auto-downgrade: switch to lower quality on buffering / error ----------
  useEffect(() => {
    if (!media || !sources || sources.length <= 1) return

    let bufferStallTimer = null
    let bufferTimestamps = []
    let isSourceTransitioning = false
    let sourceTransitionTimer = null

    const clearStallTimer = () => {
      if (bufferStallTimer) {
        clearTimeout(bufferStallTimer)
        bufferStallTimer = null
      }
    }

    const clearTransitionTimer = () => {
      if (sourceTransitionTimer) {
        clearTimeout(sourceTransitionTimer)
        sourceTransitionTimer = null
      }
    }

    const switchToNextSource = () => {
      onSourceChange((prev) => {
        if (prev + 1 < sources.length) return prev + 1
        return prev
      })
    }

    const handleError = () => {
      if (isSourceTransitioning) {
        setTimeout(() => {
          if (media.error) {
            isSourceTransitioning = false
            clearTransitionTimer()
            switchToNextSource()
          }
        }, 1000)
      } else {
        switchToNextSource()
      }
    }

    const handleLoadStart = () => {
      isSourceTransitioning = true
      bufferTimestamps = []
      clearStallTimer()
      clearTransitionTimer()
      sourceTransitionTimer = setTimeout(() => {
        isSourceTransitioning = false
      }, BUFFER_STALL_TIMEOUT_MS)
    }

    const handleCanPlay = () => {
      isSourceTransitioning = false
      clearTransitionTimer()
    }

    const handleWaiting = () => {
      if (isSourceTransitioning) return

      const now = Date.now()
      bufferTimestamps.push(now)
      bufferTimestamps = bufferTimestamps.filter((t) => now - t < BUFFER_COUNT_WINDOW_MS)

      if (bufferTimestamps.length >= BUFFER_COUNT_THRESHOLD) {
        bufferTimestamps = []
        clearStallTimer()
        switchToNextSource()
        return
      }

      clearStallTimer()
      bufferStallTimer = setTimeout(() => {
        if (media.paused || media.readyState < 3) {
          bufferTimestamps = []
          switchToNextSource()
        }
      }, BUFFER_STALL_TIMEOUT_MS)
    }

    const handlePlayingOrPause = () => clearStallTimer()

    media.addEventListener('error', handleError)
    media.addEventListener('loadstart', handleLoadStart)
    media.addEventListener('canplay', handleCanPlay)
    media.addEventListener('waiting', handleWaiting)
    media.addEventListener('playing', handlePlayingOrPause)
    media.addEventListener('pause', handlePlayingOrPause)
    media.addEventListener('seeked', handlePlayingOrPause)

    return () => {
      clearStallTimer()
      clearTransitionTimer()
      media.removeEventListener('error', handleError)
      media.removeEventListener('loadstart', handleLoadStart)
      media.removeEventListener('canplay', handleCanPlay)
      media.removeEventListener('waiting', handleWaiting)
      media.removeEventListener('playing', handlePlayingOrPause)
      media.removeEventListener('pause', handlePlayingOrPause)
      media.removeEventListener('seeked', handlePlayingOrPause)
    }
  }, [media, sources, onSourceChange])

  return null
}

/**
 * SpacebarToggle — listens for the spacebar key and toggles play/pause.
 */
function SpacebarToggle() {
  const media = Player.useMedia()

  useEffect(() => {
    if (!media) return

    const handleKeyDown = (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const tag = document.activeElement?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      e.preventDefault()
      if (media.paused) {
        media.play()?.catch(() => {})
      } else {
        media.pause()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [media])

  return null
}

/**
 * FrameStepKeys — listens for , and . keys to step one frame backward/forward.
 */
const FRAME_STEP_INTERVAL_MS = 150

function FrameStepKeys() {
  const media = Player.useMedia()
  const lastStepAt = useRef(0)
  const frameDuration = useRef(1 / 30)
  const isStepping = useRef(false)

  useEffect(() => {
    if (!media || typeof media.requestVideoFrameCallback !== 'function') return

    let handle
    let prevMediaTime = null
    let prevPresentedFrames = null

    const onFrame = (_, metadata) => {
      if (!isStepping.current && prevMediaTime !== null && prevPresentedFrames !== null) {
        const timeDelta = metadata.mediaTime - prevMediaTime
        const frameDelta = metadata.presentedFrames - prevPresentedFrames
        if (frameDelta > 0 && timeDelta > 0) {
          const perFrame = timeDelta / frameDelta
          if (perFrame > 1 / 240 && perFrame < 1 / 8) {
            frameDuration.current = perFrame
          }
        }
      }
      if (!isStepping.current) {
        prevMediaTime = metadata.mediaTime
        prevPresentedFrames = metadata.presentedFrames
      } else {
        prevMediaTime = null
        prevPresentedFrames = null
      }
      handle = media.requestVideoFrameCallback(onFrame)
    }

    handle = media.requestVideoFrameCallback(onFrame)
    return () => media.cancelVideoFrameCallback(handle)
  }, [media])

  useEffect(() => {
    if (!media) return

    const handleKeyDown = (e) => {
      if (e.key !== ',' && e.key !== '.') return
      const tag = document.activeElement?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      const now = Date.now()
      if (now - lastStepAt.current < FRAME_STEP_INTERVAL_MS) return
      lastStepAt.current = now

      e.preventDefault()
      isStepping.current = true
      media.pause()
      media.currentTime = Math.min(
        Math.max(media.currentTime + (e.key === '.' ? frameDuration.current : -frameDuration.current), 0),
        media.duration || 0,
      )
      media
        .play()
        .then(() => {
          media.pause()
          isStepping.current = false
        })
        .catch(() => {
          isStepping.current = false
        })
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [media])

  return null
}

/**
 * VideoJSPlayer — a drop-in replacement powered by Video.js 10.
 *
 * Accepts the same props as the previous v8 component so that consumers
 * (Watch.js, VideoModal.js) do not need to change their usage.
 */
const VideoJSPlayer = ({
  sources,
  poster,
  autoplay = false,
  fill = false,
  playsinline = false,
  onTimeUpdate,
  onReady,
  startTime,
  forceMuted = false,
  className,
  style,
}) => {
  const [currentSourceIndex, setCurrentSourceIndex] = useState(() => {
    const idx = sources?.findIndex((s) => s.selected)
    return idx >= 0 ? idx : 0
  })

  const prevSourcesRef = useRef(sources)
  useEffect(() => {
    const prevSrcs = prevSourcesRef.current?.map((s) => s.src)
    const nextSrcs = sources?.map((s) => s.src)
    const changed = prevSrcs?.length !== nextSrcs?.length || prevSrcs?.some((s, i) => s !== nextSrcs[i])
    if (changed) {
      prevSourcesRef.current = sources
      const idx = sources?.findIndex((s) => s.selected)
      setCurrentSourceIndex(idx >= 0 ? idx : 0)
    }
  }, [sources])

  const activeSrc = sources?.[currentSourceIndex]?.src || sources?.[0]?.src

  const containerStyle = {
    maxWidth: '100%',
    ...(fill && { width: '100%', height: '100%' }),
    ...style,
  }

  return (
    <Player.Provider>
      <CustomVideoSkin
        className={className}
        style={containerStyle}
        sources={sources}
        currentSourceIndex={currentSourceIndex}
        onQualitySelect={setCurrentSourceIndex}
      >
        <Video src={activeSrc} autoPlay={autoplay} playsInline={playsinline} preload="auto" muted={forceMuted} />
        {poster && <Poster src={poster} alt="" />}
      </CustomVideoSkin>
      <PlayerEffects
        sources={sources}
        onSourceChange={setCurrentSourceIndex}
        onTimeUpdate={onTimeUpdate}
        onReady={onReady}
        startTime={startTime}
        forceMuted={forceMuted}
      />
      <SpacebarToggle />
      <FrameStepKeys />
    </Player.Provider>
  )
}

export default VideoJSPlayer
