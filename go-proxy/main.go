package main

import (
	"log"
	"net/http"
	"strconv"

	"go-proxy/internal/config"
	routes "go-proxy/internal/http"
)

func main() {
	cfg := config.Default()
	addr := cfg.Host + ":" + strconv.Itoa(cfg.Port)

	log.Printf("go-proxy listening on %s", addr)
	if err := http.ListenAndServe(addr, routes.NewRoutes(cfg)); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
