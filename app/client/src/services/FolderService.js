import Api from './Api'

const service = {
  getFolders() {
    return Api().get('/api/folders')
  },
  getFolder(uuid) {
    return Api().get(`/api/folders/${uuid}`)
  },
  getFolderMedia(uuid, mediaType, params = {}) {
    const path = mediaType === 'image' ? `/api/folders/${uuid}/images` : `/api/folders/${uuid}/videos`
    return Api().get(path, { params })
  },
  updateFolderPrivacy(uuid, isPrivate) {
    return Api().put(`/api/folders/${uuid}`, { private: isPrivate })
  },
  getFolderByPath(path, type = 'video') {
    return Api().get('/api/folders/by-path', { params: { path, type } })
  },
}

export default service
