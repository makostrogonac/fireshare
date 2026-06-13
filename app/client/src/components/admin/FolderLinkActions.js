import React, { useEffect, useState } from 'react'
import { IconButton, Tooltip } from '@mui/material'
import { CopyToClipboard } from 'react-copy-to-clipboard'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import FolderService from '../../services/FolderService'

// Renders "copy link" / "open folder view" buttons for a directory row in the file manager.
// Looks up the corresponding MediaFolder by relative path + media type; renders nothing if
// the folder hasn't been scanned yet.
export default function FolderLinkActions({ path, mediaType, setAlert }) {
  const [folder, setFolder] = useState(null)

  useEffect(() => {
    let cancelled = false
    setFolder(null)
    FolderService.getFolderByPath(path, mediaType)
      .then(({ data }) => {
        if (!cancelled) setFolder(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [path, mediaType])

  if (!folder) return null

  const folderUrl = `${window.location.origin}/folder/${folder.uuid}`

  return (
    <>
      <Tooltip title="Copy folder link">
        <span>
          <CopyToClipboard text={folderUrl}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                if (setAlert) {
                  setAlert({ open: true, message: 'Folder link copied to clipboard', type: 'info' })
                }
              }}
              sx={{ color: '#FFFFFF66', p: 0.25, '&:hover': { color: '#FFFFFFAA', bgcolor: '#FFFFFF0D' } }}
            >
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </CopyToClipboard>
        </span>
      </Tooltip>
      <Tooltip title="Open folder view">
        <span>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              window.open(`/folder/${folder.uuid}`, '_blank', 'noopener,noreferrer')
            }}
            sx={{ color: '#FFFFFF66', p: 0.25, '&:hover': { color: '#FFFFFFAA', bgcolor: '#FFFFFF0D' } }}
          >
            <OpenInNewIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </span>
      </Tooltip>
    </>
  )
}
