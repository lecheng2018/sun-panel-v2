package system

import (
	"sun-panel/api/api_v1"

	"github.com/gin-gonic/gin"
)

func InitPingRouter(router *gin.RouterGroup) {
	ping := api_v1.ApiGroupApp.ApiSystem.Ping
	{
		router.GET("ping", func(c *gin.Context) {
			c.Header("Access-Control-Allow-Origin", "*")
			c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "*")
			c.Next()
		}, ping.Get)

		router.OPTIONS("ping", func(c *gin.Context) {
			c.Header("Access-Control-Allow-Origin", "*")
			c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "*")
			c.Status(204)
		})
	}
}
