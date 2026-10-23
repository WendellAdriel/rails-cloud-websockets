Rails.application.routes.draw do
  root "demo#index"
  get "/about", to: "demo#about"
  get "/up", to: "demo#health"
  get "/audit", to: "demo#audit"
  post "/broadcast", to: "demo#broadcast"
  post "/reports", to: "demo#report"
  post "/revoke", to: "demo#revoke"
  post "/logout", to: "demo#logout"
end
