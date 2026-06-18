import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Box, Typography, CircularProgress, Menu, MenuItem, Button, Slider, IconButton, Tabs, Tab } from '@mui/material'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { getUrl } from '../../common/utils'
import MergeIcon from '@mui/icons-material/MergeType'
import AddIcon from '@mui/icons-material/Add'

const labelSx = { fontSize: 11, color: '#FFFFFFB3', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }

const numInputSx = {
  width: 80,
  bgcolor: '#FFFFFF0D',
  border: '1px solid #FFFFFF26',
  borderRadius: '6px',
  color: 'white',
  fontSize: 13,
  fontFamily: 'monospace',
  padding: '4px 8px',
  outline: 'none',
  '&:focus': { borderColor: '#3399FF' },
}

const TIMELINE_HEIGHT = 20 // px

/**
 * WaveformCropper — renders audio waveforms for video audio tracks
 * with a draggable/resizable region marking the crop start and end points.
 *
 * Supports multiple audio tracks with:
 *   - Tab switching between tracks
 *   - Individual volume control per track
 *   - Merging two tracks into a combined waveform
 *
 * Props:
 *   videoId       — video ID used to build /api/video/audio?id={videoId}&track={n}
 *   duration      — original video duration in seconds (used as fallback)
 *   startTime     — current crop start (null = full start)
 *   endTime       — current crop end   (null = full end)
 *   audioTracks   — array of audio track objects from /api/video/audio-tracks
 *   onChange      — ({ startTime: number|null, endTime: number|null }) => void
 *   onSeek        — (time) => void — seek the video player to the given time
 *   getCurrentTime — () => number — current playback position
 */
const WaveformCropper = React.forwardRef(
  ({ videoId, duration, startTime, endTime, audioTracks, onChange, onSeek, getCurrentTime }, ref) => {
    const containerRef = useRef(null)
    const timelineCanvasRef = useRef(null)
    const extScrollbarRef = useRef(null)
    const extScrollbarInnerRef = useRef(null)
    const isSyncingScroll = useRef(false)
    const drawTimelineRef = useRef(() => {})
    const wsRef = useRef(null)
    const regionsPluginRef = useRef(null)
    const regionRef = useRef(null)
    const onSeekRef = useRef(onSeek)
    const getCurrentTimeRef = useRef(getCurrentTime)
    const zoomRef = useRef(1)
    const minZoomRef = useRef(1)
    const isReadyRef = useRef(false)
    const cursorTimeRef = useRef(0)

    // Multi-track state
    const tracks = audioTracks && audioTracks.length > 0 ? audioTracks : [{ track_num: 0, title: 'Default', index: null }]
    const [activeTrack, setActiveTrack] = useState(0)
    const [trackVolumes, setTrackVolumes] = useState(() => tracks.map(() => 100))
    const [mergedTracks, setMergedTracks] = useState(null) // null | [trackA_index, trackB_index]
    const [mergeVolume, setMergeVolume] = useState(50) // balance between two merged tracks
    const [contextMenu, setContextMenu] = useState(null) // { x, y, cursorTime } | null

    useEffect(() => {
      onSeekRef.current = onSeek
    }, [onSeek])
    useEffect(() => {
      getCurrentTimeRef.current = getCurrentTime
    }, [getCurrentTime])

    // Expose a seekTo(time) handle so VideoModal can sync the cursor with video playback
    React.useImperativeHandle(
      ref,
      () => ({
        seekTo: (time) => {
          const ws = wsRef.current
          if (!ws || !isReadyRef.current) return
          const total = ws.getDuration()
          if (!total) return
          cursorTimeRef.current = time
          ws.seekTo(Math.max(0, Math.min(1, time / total)))
        },
        getTrackVolumes: () => trackVolumes,
        getMergedTracks: () => mergedTracks,
      }),
      [trackVolumes, mergedTracks],
    )

    const [isLoading, setIsLoading] = useState(true)
    const [loadError, setLoadError] = useState(false)
    const [localStart, setLocalStart] = useState(startTime ?? 0)
    const [localEnd, setLocalEnd] = useState(endTime ?? duration ?? 0)
    const [totalDuration, setTotalDuration] = useState(duration ?? 0)

    // Emit null when values are trivially close to full range
    const toNullable = (s, e, total) => ({
      startTime: s <= 0.05 ? null : s,
      endTime: e >= total - 0.05 ? null : e,
    })

    // Keep the external scrollbar's inner width in sync with WaveSurfer's content width
    const syncScrollbarWidth = () => {
      const scrollContainer = wsRef.current?.getWrapper()?.parentElement
      if (!scrollContainer || !extScrollbarInnerRef.current) return
      extScrollbarInnerRef.current.style.width = scrollContainer.scrollWidth + 'px'
    }

    // Build the audio URL based on active track or merged state
    const buildAudioUrl = useCallback(() => {
      if (mergedTracks) {
        // When merged, use the first track's audio as base (merge is done visually)
        const t = tracks[mergedTracks[1]] || tracks[0]
        if (t.index != null) {
          return `${getUrl()}/api/video/audio?id=${videoId}&track=${t.index}`
        }
      }
      const t = tracks[activeTrack]
      if (t && t.index != null) {
        return `${getUrl()}/api/video/audio?id=${videoId}&track=${t.index}`
      }
      return `${getUrl()}/api/video/audio?id=${videoId}`
    }, [videoId, activeTrack, mergedTracks, tracks])

    // Main Wavesurfer setup
    useEffect(() => {
      if (!containerRef.current) return

      // ── Custom canvas timeline ──────────────────────────────────────────────
      const drawTimeline = () => {
        const canvas = timelineCanvasRef.current
        if (!canvas || !isReadyRef.current) return
        const ws = wsRef.current
        const dur = ws?.getDuration() ?? 0
        if (!dur || zoomRef.current <= 0) return

        const scrollLeft = ws.getScroll()
        const pxPerSec = (ws?.getWrapper()?.offsetWidth ?? 0) / dur
        const dpr = window.devicePixelRatio || 1
        const cssWidth = canvas.offsetWidth
        const cssHeight = canvas.offsetHeight

        canvas.width = cssWidth * dpr
        canvas.height = cssHeight * dpr

        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, cssWidth, cssHeight)

        const niceAll = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
        const niceLabel = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
        const tickInterval = niceAll.find((n) => n >= 40 / pxPerSec) ?? 600
        const labelInterval = niceLabel.find((n) => n >= 120 / pxPerSec) ?? 600
        const labelsPerTick = Math.max(1, Math.round(labelInterval / tickInterval))

        const start = scrollLeft / pxPerSec
        const firstTickIndex = Math.max(0, Math.floor(start / tickInterval))
        const firstTick = firstTickIndex * tickInterval

        ctx.font = `13px monospace, -apple-system, sans-serif`
        ctx.textBaseline = 'top'

        for (let i = 0; ; i++) {
          const t = firstTick + i * tickInterval
          if (t > dur + tickInterval) break
          const x = Math.round(t * pxPerSec - scrollLeft)
          if (x > cssWidth + 2) break

          const isLabel = (firstTickIndex + i) % labelsPerTick === 0

          ctx.globalAlpha = isLabel ? 0.5 : 0.2
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x + 0.5, isLabel ? 0 : cssHeight * 0.55)
          ctx.lineTo(x + 0.5, cssHeight)
          ctx.stroke()

          if (isLabel) {
            const m = Math.floor(t / 60)
            const s = Math.floor(t % 60)
            const label = `${m}:${s.toString().padStart(2, '0')}`
            ctx.globalAlpha = 0.55
            ctx.fillStyle = '#ffffff'
            ctx.fillText(label, x + 3, 1)
          }
        }
      }
      drawTimelineRef.current = drawTimeline

      const regionsPlugin = RegionsPlugin.create()
      regionsPluginRef.current = regionsPlugin

      const audioUrl = buildAudioUrl()

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: mergedTracks ? '#FFD70040' : '#FFFFFF30',
        progressColor: mergedTracks ? '#FFD700ce' : '#3399ffce',
        cursorColor: 'rgba(255, 255, 255, 0.85)',
        cursorWidth: 2,
        height: 64,
        barHeight: 1,
        normalize: true,
        interact: false,
        autoScroll: false,
        autoCenter: false,
        barWidth: 1,
        barGap: 1,
        barRadius: 0,
        barAlign: 'bottom',
        url: audioUrl,
        fetchParams: { credentials: 'include', signal: AbortSignal.timeout(180000) },
        plugins: [regionsPlugin],
      })
      wsRef.current = ws

      ws.on('error', () => {
        setIsLoading(false)
        setLoadError(true)
      })

      ws.on('ready', () => {
        isReadyRef.current = true
        const total = ws.getDuration()
        setTotalDuration(total)
        setIsLoading(false)

        const s = startTime ?? 0
        const e = endTime ?? total

        setLocalStart(s)
        setLocalEnd(e)

        regionRef.current = regionsPlugin.addRegion({
          start: s,
          end: e,
          color: mergedTracks ? 'rgba(255, 215, 0, 0.36)' : 'rgba(51, 153, 255, 0.36)',
          drag: true,
          resize: true,
          minLength: 1,
        })

        const handleEls = regionRef.current.element?.querySelectorAll('[part~="region-handle"]')
        if (handleEls?.length) {
          handleEls.forEach((el) => {
            const side = el.getAttribute('part')?.includes('left') ? 'left' : 'right'
            const color = mergedTracks ? 'rgba(255, 215, 0, 0.88)' : 'rgba(51, 153, 255, 0.88)'
            Object.assign(el.style, {
              width: '6px',
              background: color,
              border: 'none',
              cursor: 'ew-resize',
              borderRadius: side === 'left' ? '3px 0 0 3px' : '0 3px 3px 0',
            })
            ;['-5px', '0px', '5px'].forEach((offset) => {
              const line = document.createElement('div')
              Object.assign(line.style, {
                position: 'absolute',
                width: '6px',
                height: '2px',
                background: 'rgba(255, 255, 255, 0.5)',
                left: '50%',
                top: '50%',
                transform: `translate(-50%, calc(-50% + ${offset}))`,
                borderRadius: '1px',
                pointerEvents: 'none',
              })
              el.appendChild(line)
            })
          })
        }

        onChange(toNullable(s, e, total))

        const currentVideoTime = getCurrentTimeRef.current?.() ?? 0
        if (currentVideoTime > 0 && total > 0) {
          ws.seekTo(Math.max(0, Math.min(1, currentVideoTime / total)))
        }

        const containerWidth = containerRef.current?.clientWidth || 500
        const fitZoom = containerWidth / total
        minZoomRef.current = fitZoom
        zoomRef.current = fitZoom
        ws.zoom(fitZoom)

        const scrollContainer = ws.getWrapper()?.parentElement
        if (scrollContainer) {
          scrollContainer.style.scrollbarWidth = 'none'
          scrollContainer.style.msOverflowStyle = 'none'
          if (!document.getElementById('__fs_ws_hide_sb')) {
            const styleEl = document.createElement('style')
            styleEl.id = '__fs_ws_hide_sb'
            styleEl.textContent = '.__fs_ws_hide_sb::-webkit-scrollbar{display:none}'
            document.head.appendChild(styleEl)
          }
          scrollContainer.classList.add('__fs_ws_hide_sb')
        }

        requestAnimationFrame(() => {
          drawTimeline()
          syncScrollbarWidth()
        })
      })

      ws.on('scroll', () => {
        if (!isSyncingScroll.current && extScrollbarRef.current) {
          isSyncingScroll.current = true
          extScrollbarRef.current.scrollLeft = ws.getScroll()
          isSyncingScroll.current = false
        }
        drawTimeline()
      })

      regionsPlugin.on('region-updated', (region) => {
        const total = wsRef.current?.getDuration() ?? totalDuration
        const s = parseFloat(Math.max(0, region.start).toFixed(2))
        const e = parseFloat(Math.min(total, region.end).toFixed(2))
        setLocalStart(s)
        setLocalEnd(e)
        onChange(toNullable(s, e, total))
      })

      const container = containerRef.current
      const handleClick = (e) => {
        const ws = wsRef.current
        if (!ws || !ws.getDuration()) return
        const wrapper = ws.getWrapper()
        const rect = wrapper.getBoundingClientRect()
        const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        cursorTimeRef.current = progress * ws.getDuration()
        ws.seekTo(progress)
        onSeekRef.current?.(cursorTimeRef.current)
      }

      const handleContextMenu = (e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, cursorTime: cursorTimeRef.current })
      }

      const handleWheel = (e) => {
        if (e.deltaY === 0 || !wsRef.current) return
        e.preventDefault()
        const newZoom = Math.max(minZoomRef.current, Math.min(500, zoomRef.current * (e.deltaY < 0 ? 1.3 : 0.77)))
        zoomRef.current = newZoom
        wsRef.current.zoom(newZoom)
        requestAnimationFrame(() => {
          drawTimeline()
          syncScrollbarWidth()
        })
      }

      container.addEventListener('click', handleClick)
      container.addEventListener('contextmenu', handleContextMenu)
      container.addEventListener('wheel', handleWheel, { passive: false })

      return () => {
        isReadyRef.current = false
        ws.destroy()
        container.removeEventListener('click', handleClick)
        container.removeEventListener('contextmenu', handleContextMenu)
        container.removeEventListener('wheel', handleWheel)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoId, activeTrack, mergedTracks])

    const handleExternalScroll = () => {
      if (isSyncingScroll.current) return
      const ws = wsRef.current
      if (!ws || !extScrollbarRef.current) return
      isSyncingScroll.current = true
      ws.setScroll(extScrollbarRef.current.scrollLeft)
      isSyncingScroll.current = false
      drawTimelineRef.current()
    }

    const handleStartChange = (val) => {
      const total = wsRef.current?.getDuration() ?? totalDuration
      const clamped = parseFloat(Math.max(0, Math.min(val, localEnd - 1)).toFixed(2))
      setLocalStart(clamped)
      if (regionRef.current) regionRef.current.setOptions({ start: clamped })
      onChange(toNullable(clamped, localEnd, total))
    }

    const handleEndChange = (val) => {
      const total = wsRef.current?.getDuration() ?? totalDuration
      const clamped = parseFloat(Math.min(total, Math.max(val, localStart + 1)).toFixed(2))
      setLocalEnd(clamped)
      if (regionRef.current) regionRef.current.setOptions({ end: clamped })
      onChange(toNullable(localStart, clamped, total))
    }

    const handleReset = () => {
      const total = wsRef.current?.getDuration() ?? totalDuration
      if (regionRef.current) regionRef.current.setOptions({ start: 0, end: total })
      setLocalStart(0)
      setLocalEnd(total)
      onChange({ startTime: null, endTime: null })
    }

    const handleVolumeChange = (trackIdx, value) => {
      const newVolumes = [...trackVolumes]
      newVolumes[trackIdx] = value
      setTrackVolumes(newVolumes)
    }

    const handleToggleMerge = () => {
      if (mergedTracks) {
        setMergedTracks(null)
        setActiveTrack(0)
        setIsLoading(true)
        setLoadError(false)
      } else if (tracks.length >= 2) {
        setMergedTracks([0, 1])
        setIsLoading(true)
        setLoadError(false)
      }
    }

    return (
      <>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', height: '100%' }}>
          {/* Waveform column — cropper box + external scrollbar below it */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Track tabs */}
            {tracks.length > 1 && !mergedTracks && (
              <Tabs
                value={activeTrack}
                onChange={(_, v) => {
                  setActiveTrack(v)
                  setIsLoading(true)
                  setLoadError(false)
                }}
                sx={{
                  minHeight: 32,
                  mb: 0.5,
                  '& .MuiTab-root': {
                    minHeight: 32,
                    fontSize: 11,
                    color: '#FFFFFF66',
                    textTransform: 'none',
                    px: 1.5,
                    py: 0,
                    '&.Mui-selected': { color: '#3399FF' },
                  },
                  '& .MuiTabs-indicator': { bgcolor: '#3399FF' },
                }}
              >
                {tracks.map((t, i) => (
                  <Tab key={i} label={t.title || `Track ${i + 1}`} />
                ))}
              </Tabs>
            )}

            {mergedTracks && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, px: 1 }}>
                <MergeIcon sx={{ fontSize: 16, color: '#FFD700' }} />
                <Typography sx={{ fontSize: 11, color: '#FFD700', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
                  Merged: {tracks[mergedTracks[0]]?.title} + {tracks[mergedTracks[1]]?.title}
                </Typography>
                <Button
                  size="small"
                  onClick={handleToggleMerge}
                  sx={{ fontSize: 10, color: '#FF6B6B', minWidth: 'auto', p: '2px 6px' }}
                >
                  Unmerge
                </Button>
              </Box>
            )}

            <Box
              sx={{
                position: 'relative',
                bgcolor: mergedTracks ? '#1A1508' : '#FFFFFF08',
                border: mergedTracks ? '1px solid #FFD70033' : '1px solid #FFFFFF1A',
                borderRadius: '8px',
                overflow: 'hidden',
                minHeight: 68 + TIMELINE_HEIGHT,
              }}
            >
              <div ref={containerRef} style={{ width: '100%', overflow: 'hidden' }} />
              <canvas
                ref={timelineCanvasRef}
                style={{
                  display: 'block',
                  width: '100%',
                  height: TIMELINE_HEIGHT,
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                }}
              />
              {(isLoading || loadError) && (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1.5,
                    pb: `${TIMELINE_HEIGHT}px`,
                  }}
                >
                  {loadError ? (
                    <Typography sx={{ fontSize: 12, color: '#FF6B6B66' }}>Unable to load audio waveform</Typography>
                  ) : (
                    <>
                      <CircularProgress size={20} sx={{ color: '#3399FF' }} />
                      <Typography sx={{ fontSize: 12, color: '#FFFFFF66' }}>Loading audio…</Typography>
                    </>
                  )}
                </Box>
              )}
            </Box>

            <div
              ref={extScrollbarRef}
              onScroll={handleExternalScroll}
              style={{ overflowX: 'auto', overflowY: 'hidden', width: '100%', height: 14 }}
            >
              <div ref={extScrollbarInnerRef} style={{ height: 1 }} />
            </div>
          </Box>

          {/* Controls — horizontal row to the right */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              pb: '14px',
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1 }}>
              <Box>
                <Typography sx={labelSx}>Start (s)</Typography>
                <Box
                  component="input"
                  type="number"
                  step="0.1"
                  min={0}
                  max={localEnd - 1}
                  value={localStart}
                  disabled={isLoading}
                  onChange={(e) => handleStartChange(parseFloat(e.target.value) || 0)}
                  sx={numInputSx}
                />
              </Box>
              <Box>
                <Typography sx={labelSx}>End (s)</Typography>
                <Box
                  component="input"
                  type="number"
                  step="0.1"
                  min={localStart + 1}
                  max={totalDuration}
                  value={localEnd}
                  disabled={isLoading}
                  onChange={(e) => handleEndChange(parseFloat(e.target.value) || totalDuration)}
                  sx={numInputSx}
                />
              </Box>
            </Box>
            <Button
              size="medium"
              disabled={isLoading}
              onClick={handleReset}
              sx={{
                mt: 1,
                fontSize: 11,
                color: '#FFFFFF66',
                bgcolor: '#0D1F33',
                '&:hover': { color: 'white' },
                width: '100%',
              }}
            >
              Reset
            </Button>
          </Box>
        </Box>

        {/* Volume controls per track */}
        {tracks.length > 0 && (
          <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography sx={labelSx}>
              {mergedTracks ? 'Merge Balance' : 'Track Volumes'}
            </Typography>
            {mergedTracks ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography sx={{ fontSize: 11, color: '#FFFFFF66', minWidth: 60 }}>
                  {tracks[mergedTracks[0]]?.title || 'Track A'}
                </Typography>
                <Slider
                  size="small"
                  value={mergeVolume}
                  onChange={(_, v) => setMergeVolume(v)}
                  min={0}
                  max={100}
                  sx={{ flex: 1, color: '#FFD700', '& .MuiSlider-thumb': { width: 12, height: 12 } }}
                />
                <Typography sx={{ fontSize: 11, color: '#FFFFFF66', minWidth: 60, textAlign: 'right' }}>
                  {tracks[mergedTracks[1]]?.title || 'Track B'}
                </Typography>
              </Box>
            ) : (
              tracks.map((t, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography
                    sx={{
                      fontSize: 11,
                      color: i === activeTrack ? '#3399FF' : '#FFFFFF66',
                      minWidth: 80,
                      cursor: 'pointer',
                      fontWeight: i === activeTrack ? 700 : 400,
                    }}
                    onClick={() => {
                      setActiveTrack(i)
                      setIsLoading(true)
                      setLoadError(false)
                    }}
                  >
                    {t.title || `Track ${i + 1}`}
                  </Typography>
                  <Slider
                    size="small"
                    value={trackVolumes[i] ?? 100}
                    onChange={(_, v) => handleVolumeChange(i, v)}
                    min={0}
                    max={200}
                    sx={{
                      flex: 1,
                      color: i === activeTrack ? '#3399FF' : '#FFFFFF44',
                      '& .MuiSlider-thumb': { width: 12, height: 12 },
                    }}
                  />
                  <Typography sx={{ fontSize: 11, color: '#FFFFFF66', minWidth: 36, textAlign: 'right' }}>
                    {trackVolumes[i] ?? 100}%
                  </Typography>
                </Box>
              ))
            )}
            {tracks.length >= 2 && (
              <Button
                size="small"
                onClick={handleToggleMerge}
                startIcon={mergedTracks ? null : <MergeIcon />}
                sx={{
                  mt: 0.5,
                  fontSize: 11,
                  color: mergedTracks ? '#FF6B6B' : '#FFD700',
                  bgcolor: mergedTracks ? '#1A0D0D' : '#1A1508',
                  border: mergedTracks ? '1px solid #FF6B6B33' : '1px solid #FFD70033',
                  '&:hover': {
                    bgcolor: mergedTracks ? '#2A1515' : '#2A2008',
                  },
                }}
              >
                {mergedTracks ? 'Unmerge Tracks' : 'Merge Tracks 1 + 2'}
              </Button>
            )}
          </Box>
        )}

        <Menu
          open={contextMenu !== null}
          onClose={() => setContextMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined}
          slotProps={{
            paper: { sx: { bgcolor: '#0D1F33', border: '1px solid #FFFFFF1A', color: 'white', minWidth: 140 } },
          }}
        >
          <MenuItem
            disabled={contextMenu?.cursorTime >= localEnd}
            onClick={() => {
              handleStartChange(parseFloat(contextMenu.cursorTime.toFixed(2)))
              setContextMenu(null)
            }}
            sx={{
              fontSize: 13,
              color: 'white',
              '&:hover': { bgcolor: '#FFFFFF14' },
              '&.Mui-disabled': { color: '#FFFFFF33' },
            }}
          >
            Set Start
          </MenuItem>
          <MenuItem
            disabled={contextMenu?.cursorTime <= localStart}
            onClick={() => {
              handleEndChange(parseFloat(contextMenu.cursorTime.toFixed(2)))
              setContextMenu(null)
            }}
            sx={{
              fontSize: 13,
              color: 'white',
              '&:hover': { bgcolor: '#FFFFFF14' },
              '&.Mui-disabled': { color: '#FFFFFF33' },
            }}
          >
            Set End
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleReset()
              setContextMenu(null)
            }}
            sx={{ fontSize: 13, color: '#FFFFFF99', '&:hover': { bgcolor: '#FFFFFF14', color: 'white' } }}
          >
            Reset
          </MenuItem>
        </Menu>
      </>
    )
  },
)

export default WaveformCropper
