import React, { useEffect, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, Menu, MenuItem, Button, Slider, Checkbox, Tabs, Tab } from '@mui/material'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { getUrl } from '../../common/utils'

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
 *   - Tab switching between tracks to view individual waveforms
 *   - Checkbox to include/exclude each track from the final clip
 *   - Individual volume control (0-200%) per track
 *
 * Props:
 *   videoId       — video ID used to build /api/video/audio?id={videoId}&track={n}&quality=waveform
 *   duration      — original video duration in seconds (used as fallback)
 *   startTime     — current crop start (null = full start)
 *   endTime       — current crop end   (null = full end)
 *   audioTracks   — array of audio track objects from /api/video/audio-tracks
 *   trackSettings — array of {track_num, volume, enabled} — current track selection state
 *   onTrackSettingChange — (track_num, setting) => void — update a single track's settings
 *   onChange      — ({ startTime: number|null, endTime: number|null }) => void
 *   onSeek        — (time) => void — seek the video player to the given time
 *   getCurrentTime — () => number — current playback position
 */
const WaveformCropper = React.forwardRef(
  (
    {
      videoId,
      duration,
      startTime,
      endTime,
      audioTracks,
      trackSettings,
      onTrackSettingChange,
      onChange,
      onSeek,
      getCurrentTime,
    },
    ref,
  ) => {
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

    const hasRealAudioTracks = audioTracks && audioTracks.length > 0
    const tracks = React.useMemo(
      () => (hasRealAudioTracks ? audioTracks : [{ title: 'Default', index: 0 }]),
      [audioTracks, hasRealAudioTracks],
    )
    const [activeTrack, setActiveTrack] = useState(0)
    const activeTrackInfo = tracks[Math.min(activeTrack, tracks.length - 1)]
    const activeTrackNum = activeTrackInfo?.track_num
    const audioUrl = React.useMemo(() => {
      if (activeTrackNum != null) {
        return `${getUrl()}/api/video/audio?id=${videoId}&track=${activeTrackNum}&quality=waveform`
      }
      return `${getUrl()}/api/video/audio?id=${videoId}&quality=waveform`
    }, [videoId, activeTrackNum])
    const [contextMenu, setContextMenu] = useState(null)

    useEffect(() => {
      if (activeTrack >= tracks.length) setActiveTrack(0)
    }, [activeTrack, tracks.length])

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
      }),
      [],
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

      const fetchController = new AbortController()

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#FFFFFF30',
        progressColor: '#3399ffce',
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
        fetchParams: { credentials: 'include', signal: fetchController.signal },
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
          color: 'rgba(51, 153, 255, 0.36)',
          drag: true,
          resize: true,
          minLength: 1,
        })

        const handleEls = regionRef.current.element?.querySelectorAll('[part~="region-handle"]')
        if (handleEls?.length) {
          handleEls.forEach((el) => {
            const side = el.getAttribute('part')?.includes('left') ? 'left' : 'right'
            const color = 'rgba(51, 153, 255, 0.88)'
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

        // Force region update to ensure callbacks fire
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
        fetchController.abort()
        ws.destroy()
        container.removeEventListener('click', handleClick)
        container.removeEventListener('contextmenu', handleContextMenu)
        container.removeEventListener('wheel', handleWheel)
      }
      // Recreate WaveSurfer only when the active waveform URL changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioUrl])

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

    const enabledCount = tracks.filter((t) => {
      const ts = trackSettings?.find((s) => s.track_num === t.track_num)
      return ts ? ts.enabled : true // default enabled
    }).length

    return (
      <>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', height: '100%' }}>
          {/* Waveform column — cropper box + external scrollbar below it */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Track tabs */}
            {tracks.length > 1 && (
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
                {tracks.map((t, i) => {
                  const ts = trackSettings?.find((s) => s.track_num === t.track_num)
                  const enabled = ts ? ts.enabled : true
                  return (
                    <Tab
                      key={i}
                      label={
                        <span style={{ opacity: enabled ? 1 : 0.4 }}>
                          {t.title || `Track ${i + 1}`}
                        </span>
                      }
                    />
                  )
                })}
              </Tabs>
            )}

            <Box
              sx={{
                position: 'relative',
                bgcolor: '#FFFFFF08',
                border: '1px solid #FFFFFF1A',
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

        {/* Per-track selection and volume controls */}
        {hasRealAudioTracks && tracks.length > 0 && (
          <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography sx={labelSx}>
              Audio Tracks ({enabledCount} enabled)
            </Typography>
            {tracks.map((t, i) => {
              const ts = trackSettings?.find((s) => s.track_num === t.track_num)
              const enabled = ts ? ts.enabled : true
              const volume = ts?.volume ?? 100

              return (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Checkbox
                    checked={enabled}
                    onChange={(e) =>
                      onTrackSettingChange?.(t.track_num, { enabled: e.target.checked, volume })
                    }
                    size="small"
                    sx={{
                      color: '#FFFFFF44',
                      p: 0.5,
                      '&.Mui-checked': { color: '#3399FF' },
                      '& .MuiSvgIcon-root': { fontSize: 18 },
                    }}
                  />
                  <Typography
                    sx={{
                      fontSize: 11,
                      color: i === activeTrack ? '#3399FF' : '#FFFFFF88',
                      minWidth: 80,
                      cursor: 'pointer',
                      fontWeight: i === activeTrack ? 700 : 400,
                      opacity: enabled ? 1 : 0.4,
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
                    value={Math.min(volume, 200)}
                    onChange={(_, v) =>
                      onTrackSettingChange?.(t.track_num, { enabled, volume: v })
                    }
                    min={0}
                    max={200}
                    disabled={!enabled}
                    sx={{
                      flex: 1,
                      color: enabled ? '#3399FF' : '#FFFFFF22',
                      '& .MuiSlider-thumb': { width: 12, height: 12 },
                      '&.Mui-disabled': { color: '#FFFFFF15' },
                    }}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.35 }}>
                    <Box
                      component="input"
                      type="number"
                      min="0"
                      value={volume}
                      disabled={!enabled}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10)
                        if (!isNaN(v) && v >= 0) {
                          onTrackSettingChange?.(t.track_num, { enabled, volume: v })
                        }
                      }}
                      sx={{
                        width: 48,
                        bgcolor: enabled ? '#FFFFFF0D' : '#FFFFFF05',
                        border: '1px solid',
                        borderColor: enabled ? '#FFFFFF26' : '#FFFFFF10',
                        borderRadius: '4px',
                        color: enabled ? '#FFFFFF' : '#FFFFFF33',
                        fontSize: 11,
                        fontFamily: 'monospace',
                        padding: '2px 4px',
                        outline: 'none',
                        textAlign: 'right',
                        '&:focus': { borderColor: '#3399FF' },
                        '&::-webkit-inner-spin-button, &::-webkit-outer-spin-button': {
                          WebkitAppearance: 'none',
                          margin: 0,
                        },
                        MozAppearance: 'textfield',
                      }}
                    />
                    <Typography sx={{ fontSize: 11, color: enabled ? '#FFFFFF88' : '#FFFFFF33' }}>%</Typography>
                  </Box>
                </Box>
              )
            })}
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
