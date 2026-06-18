import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import '@videojs/react/video/skin.css'
import './videoSkinOverrides.css'
import { createPlayer, useMedia, Poster } from '@videojs/react'
import { Video, videoFeatures } from '@videojs/react/video'
import CustomVideoSkin from './CustomVideoSkin'
import { getUrl } from '../../common/utils'

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

/**
 * AudioTrackSync — plays secondary audio tracks alongside the main video,
 * keeping them in sync with playback and respecting individual volumes.
 * Audio track URLs are fetched from /api/video/audio?id={videoId}&track={index}
 */
function AudioTrackSync({ videoId, audioTracks, trackVolumes }) {
  const media = Player.useMedia()
  const audioRefs = useRef([])
  const syncIntervalRef = useRef(null)
  const [trackUrls, setTrackUrls] = useState([])

  // Build audio URLs for each track
  useEffect(() => {
    if (!audioTracks || audioTracks.length === 0 || !videoId) return
    const urls = audioTracks
      .filter((t) => t.index != null)
      .map((t) => `${getUrl()}/api/video/audio?id=${videoId}&track=${t.index}`)
    setTrackUrls(urls)
  }, [videoId, audioTracks])

  // Play/pause secondary audio in sync with main video
  useEffect(() => {
    if (!media || trackUrls.length === 0) return

    const handlePlay = () => {
      audioRefs.current.forEach((a) => {
        if (a) {
          a.currentTime = media.currentTime
          a.play().catch(() => {})
        }
      })
    }

    const handlePause = () => {
      audioRefs.current.forEach((a) => {
        if (a) a.pause()
      })
    }

    const handleSeeked = () => {
      audioRefs.current.forEach((a) => {
        if (a) a.currentTime = media.currentTime
      })
    }

    const handleRateChange = () => {
      audioRefs.current.forEach((a) => {
        if (a) a.playbackRate = media.playbackRate
      })
    }

    media.addEventListener('play', handlePlay)
    media.addEventListener('pause', handlePause)
    media.addEventListener('seeked', handleSeeked)
    media.addEventListener('ratechange', handleRateChange)

    // Periodic sync to prevent drift (every 5 seconds)
    syncIntervalRef.current = setInterval(() => {
      if (media && !media.paused) {
        audioRefs.current.forEach((a, i) => {
          if (a && !a.paused) {
            const drift = Math.abs(a.currentTime - media.currentTime)
            if (drift > 0.3) {
              a.currentTime = media.currentTime
            }
          }
        })
      }
    }, 5000)

    return () => {
      media.removeEventListener('play', handlePlay)
      media.removeEventListener('pause', handlePause)
      media.removeEventListener('seeked', handleSeeked)
      media.removeEventListener('ratechange', handleRateChange)
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
    }
  }, [media, trackUrls])

  // Apply volume changes
  useEffect(() => {
    if (!trackVolumes) return
    audioRefs.current.forEach((a, i) => {
      if (a) {
        a.volume = Math.max(0, Math.min(1, (trackVolumes[i] ?? 100) / 100))
      }
    })
  }, [trackVolumes])

  if (trackUrls.length === 0) return null

  return (
    <div style={{ display: 'none' }} aria-hidden="true">
      {trackUrls.map((url, i) => (
        <audio
          key={i}
          ref={(el) => {
            audioRefs.current[i] = el
          }}
          src={url}
          preload="auto"
        />
      ))}
    </div>
  )
}

function PlayerEffects({ sources, onSourceChange, onTimeUpdate, onReady, startTime }) {
  const store = Player.usePlayer()
  const media = Player.useMedia()
  const currentTime = Player.usePlayer((s) => s.currentTime)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onReadyRef = useRef(onReady)
  const startTimeApplied = useRef(false)
  const readyFired = useRef(false)

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
 *
 * New: supports `audioTracks` and `trackVolumes` for dual audio playback.
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
  className,
  style,
  videoId,
  audioTracks,
  trackVolumes,
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

  // Manage audio track volumes locally (initialized from prop)
  const [localTrackVolumes, setLocalTrackVolumes] = useState(trackVolumes)
  useEffect(() => {
    setLocalTrackVolumes(trackVolumes)
  }, [trackVolumes])

  const handleTrackVolumeChange = useCallback((index, value) => {
    setLocalTrackVolumes((prev) => {
      const next = [...(prev || audioTracks?.map(() => 100) || [])]
      next[index] = value
      return next
    })
  }, [audioTracks])

  const hasAudioTracks = audioTracks && audioTracks.length > 0

  return (
    <Player.Provider>
      <CustomVideoSkin
        className={className}
        style={containerStyle}
        sources={sources}
        currentSourceIndex={currentSourceIndex}
        onQualitySelect={setCurrentSourceIndex}
        audioTracks={hasAudioTracks ? audioTracks : null}
        trackVolumes={localTrackVolumes}
        onTrackVolumeChange={handleTrackVolumeChange}
      >
        <Video src={activeSrc} autoPlay={autoplay} playsInline={playsinline} preload="auto" />
        {poster && <Poster src={poster} alt="" />}
      </CustomVideoSkin>
      <PlayerEffects
        sources={sources}
        onSourceChange={setCurrentSourceIndex}
        onTimeUpdate={onTimeUpdate}
        onReady={onReady}
        startTime={startTime}
      />
      <SpacebarToggle />
      <FrameStepKeys />
      {hasAudioTracks && (
        <AudioTrackSync
          videoId={videoId || sources?.[0]?.src?.match(/id=([^&]+)/)?.[1]}
          audioTracks={audioTracks}
          trackVolumes={localTrackVolumes}
        />
      )}
    </Player.Provider>
  )
}

export default VideoJSPlayer
