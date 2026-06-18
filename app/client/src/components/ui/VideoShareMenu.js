import React from 'react'
import { IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip } from '@mui/material'
import ShareIcon from '@mui/icons-material/Share'
import LinkIcon from '@mui/icons-material/Link'
import MovieIcon from '@mui/icons-material/Movie'
import {
  copyToClipboard,
  getPublicWatchLink,
  getDiscordEmbedMarkdownLink,
} from '../../common/utils'

/**
 * A share button that opens a small menu letting the user choose how to share
 * a video:
 *   - "Copy link"      → plain /w/<id> URL (produces an OpenGraph card embed)
 *   - "Direct embed"   → blank-text markdown link to the 720p stream URL
 *                        (produces a bare inline video embed, like a direct
 *                        .mp4 link, with no card/outline)
 *
 * Props:
 *   videoId     — the video to share
 *   shareToken  — optional share token appended to URLs so password-protected
 *                 shared videos are accessible to anyone with the link
 *   onCopied    — optional (message: string) => void callback for alerts
 *   buttonSx    — sx for the trigger IconButton
 *   iconSx      — sx for the ShareIcon
 *   tooltip     — trigger tooltip text (default "Share")
 *   ariaLabel   — aria-label for the trigger (default "share")
 *   size        — IconButton size (default "small")
 */
const VideoShareMenu = ({
  videoId,
  shareToken,
  onCopied,
  buttonSx,
  iconSx,
  tooltip = 'Share',
  ariaLabel = 'share',
  size = 'small',
}) => {
  const [anchorEl, setAnchorEl] = React.useState(null)
  const open = Boolean(anchorEl)

  const openMenu = (e) => {
    e.stopPropagation()
    setAnchorEl(e.currentTarget)
  }
  const close = () => setAnchorEl(null)

  const handleCopyLink = (e) => {
    e.stopPropagation()
    close()
    copyToClipboard(getPublicWatchLink(videoId, shareToken))
    onCopied?.('Link copied to clipboard')
  }

  const handleDirectEmbed = (e) => {
    e.stopPropagation()
    close()
    copyToClipboard(getDiscordEmbedMarkdownLink(videoId, shareToken))
    onCopied?.('Direct video embed copied to clipboard')
  }

  return (
    <>
      <Tooltip title={tooltip}>
        <IconButton size={size} onClick={openMenu} sx={buttonSx} aria-label={ariaLabel}>
          <ShareIcon sx={iconSx} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={close}
        onClick={(e) => e.stopPropagation()}
        PaperProps={{
          sx: {
            bgcolor: '#0d1b2a',
            color: 'white',
            border: '1px solid #FFFFFF26',
            minWidth: 200,
            boxShadow: '0 8px 32px #00000099',
            mt: 0.5,
          },
        }}
        MenuListProps={{ sx: { py: 0.5 } }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <MenuItem
          onClick={handleCopyLink}
          sx={{ gap: 1.5, py: 1.25, fontSize: 14, '&:hover': { bgcolor: '#FFFFFF12' } }}
        >
          <ListItemIcon sx={{ minWidth: 0, color: 'white' }}>
            <LinkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Copy link"
            secondary="OpenGraph card embed"
            secondaryTypographyProps={{ sx: { fontSize: 11, color: '#FFFFFF66' } }}
          />
        </MenuItem>
        <MenuItem
          onClick={handleDirectEmbed}
          sx={{ gap: 1.5, py: 1.25, fontSize: 14, '&:hover': { bgcolor: '#FFFFFF12' } }}
        >
          <ListItemIcon sx={{ minWidth: 0, color: 'white' }}>
            <MovieIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Direct embed"
            secondary="Bare video player (720p)"
            secondaryTypographyProps={{ sx: { fontSize: 11, color: '#FFFFFF66' } }}
          />
        </MenuItem>
      </Menu>
    </>
  )
}

export default VideoShareMenu
