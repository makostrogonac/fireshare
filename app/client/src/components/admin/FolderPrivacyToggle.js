import React, { useEffect, useState } from 'react'
import { IconButton, Tooltip, CircularProgress } from '@mui/material'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import FolderService from '../../services/FolderService'

// Renders a privacy lock/unlock toggle for a directory row in the file manager.
// Looks up the corresponding MediaFolder by relative path + media type.
// If no MediaFolder exists yet (404), shows a disabled "not yet scanned" icon.
export default function FolderPrivacyToggle({ path, mediaType, setAlert }) {
  const [folder, setFolder] = useState(null) // { uuid, private }
  const [notScanned, setNotScanned] = useState(false)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotScanned(false)
    setFolder(null)
    FolderService.getFolderByPath(path, mediaType)
      .then(({ data }) => {
        if (!cancelled) setFolder(data)
      })
      .catch((err) => {
        if (cancelled) return
        if (err.response?.status === 404) {
          setNotScanned(true)
        } else {
          console.error(err)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, mediaType])

  const handleToggle = async (e) => {
    e.stopPropagation()
    if (!folder || updating) return
    setUpdating(true)
    try {
      const { data } = await FolderService.updateFolderPrivacy(folder.uuid, !folder.private)
      setFolder(data)
    } catch (err) {
      console.error(err)
      if (setAlert) {
        setAlert({ open: true, message: err.response?.data || 'Failed to update folder privacy', type: 'error' })
      }
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <IconButton size="small" disabled sx={{ p: 0.25 }}>
        <CircularProgress size={14} sx={{ color: '#FFFFFF33' }} />
      </IconButton>
    )
  }

  if (notScanned) {
    return (
      <Tooltip title="Not yet scanned">
        <span>
          <IconButton size="small" disabled sx={{ color: '#FFFFFF22', p: 0.25 }}>
            <HelpOutlineIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </span>
      </Tooltip>
    )
  }

  if (!folder) return null

  return (
    <Tooltip title={folder.private ? 'Private folder - click to make public' : 'Public folder - click to make private'}>
      <span>
        <IconButton
          size="small"
          onClick={handleToggle}
          disabled={updating}
          sx={{
            color: folder.private ? '#FFFFFF66' : '#1DB954',
            p: 0.25,
            '&:hover': { color: folder.private ? '#FFFFFFAA' : '#1DB954', bgcolor: '#FFFFFF0D' },
          }}
        >
          {updating ? (
            <CircularProgress size={14} sx={{ color: 'inherit' }} />
          ) : folder.private ? (
            <LockIcon sx={{ fontSize: 16 }} />
          ) : (
            <LockOpenIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
      </span>
    </Tooltip>
  )
}
