import { defineStore } from 'pinia'
import { defaultState, defaultStatePanelConfig, getLocalState, removeLocalState, setLocalState } from './helper'
import { router } from '@/router'
import type { PanelStateNetworkModeEnum } from '@/enums'
import { get as getUserConfig } from '@/api/panel/userConfig'
import { ss } from '@/utils/storage'
import { useAuthStore } from '@/store/modules/auth'

// 用户配置缓存键
const USER_CONFIG_CACHE_KEY = 'USER_CONFIG_CACHE'
export const usePanelState = defineStore('panel', {
  state: (): Panel.State => getLocalState() || defaultState(),

  getters: {

  },

  actions: {
    setLeftSiderCollapsed(Collapsed: boolean) {
      this.leftSiderCollapsed = Collapsed
      // this.recordState()
    },

    setRightSiderCollapsed(Collapsed: boolean) {
      this.rightSiderCollapsed = Collapsed
      // this.recordState()
    },

    setNetworkMode(mode: PanelStateNetworkModeEnum) {
      this.networkMode = mode
      this.recordState()
    },

    // 获取云端（搭建的服务器）的面板配置
    updatePanelConfigByCloud() {
      try {
        // 检查用户是否已登录，未登录则不请求接口
        const authStore = useAuthStore()
        if (!authStore.token) {
          // 未登录时只使用本地默认配置
          this.panelConfig = defaultStatePanelConfig()
          this.recordState()
          return
        }

        // 1. 首先尝试从缓存读取数据
        const cachedData = ss.get(USER_CONFIG_CACHE_KEY)
        if (cachedData) {
          this.panelConfig = { ...defaultStatePanelConfig(), ...cachedData.panel }
          this.recordState()
          return
        }

        // 2. 缓存中没有数据，请求接口获取数据
        getUserConfig<Panel.userConfig>().then((res) => {
          if (res.code === 0) {
            this.panelConfig = { ...defaultStatePanelConfig(), ...res.data.panel }
            // 3. 将数据永久保存到缓存中
            ss.set(USER_CONFIG_CACHE_KEY, res.data)
            // 4. 检查是否启用自动获取网络壁纸
            if (this.panelConfig.autoNetworkWallpaper) {
                const apiUrl = this.panelConfig.autoNetworkWallpaperApi || 'https://img.xjh.me/random_img.php?return=302&type=bg&ctype=nature'
                this.panelConfig.backgroundImageSrc = apiUrl
            }
          }
          else {
            this.resetPanelConfig() // 重置恢复默认
          }
          this.recordState()
        })
      } catch (error) {
        console.error('获取用户配置失败', error)
        // 出错时尝试从缓存获取
        const cachedData = ss.get(USER_CONFIG_CACHE_KEY)
        if (cachedData) {
          this.panelConfig = { ...defaultStatePanelConfig(), ...cachedData.panel }
          this.recordState()
        }
        else {
          this.resetPanelConfig() // 重置恢复默认
          this.recordState()
        }
      }
    },

    resetPanelConfig() {
      this.panelConfig = defaultStatePanelConfig()
    },

    // async refreshSpaceNoteList(spaceId: string) {
    //   await getListBySpaceNoteId<Common.ListResponse<SNote.InfoTree[]>>(spaceId).then((res) => {
    //     this.notesList = res.data.list
    //   })
    // },

    async reloadRoute(id?: number) {
      // this.recordState()
      await router.push({ name: 'AppletDialog', params: { aiAppletId: id } })
    },

    recordState() {
      setLocalState(this.$state)
    },

    removeState() {
      removeLocalState()
    },
  },
})
