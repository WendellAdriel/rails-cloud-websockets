class DemoController < ApplicationController
  before_action :require_user, except: [:index, :health]

  def index
    unless session[:user_id]
      user = User.create!(name: "Guest #{SecureRandom.hex(4)}")
      session[:user_id] = user.id
    end
    @user = User.find(session[:user_id])
    @reports = @user.reports.order(created_at: :desc).limit(10)
  end

  def about
  end

  def health
    render json: { status: "ok", replica: ENV.fetch("HOSTNAME", "local"), worker: Process.pid, connections: ActionCable.server.connections.length }
  end

  def broadcast
    kind = params.fetch(:kind, "broadcast")
    text = params.require(:text).to_s.first(1000)
    case kind
    when "custom"
      ActionCable.server.broadcast("custom:demo", { text: text })
    when "model"
      ModelChannel.broadcast_to(current_user, { text: text, kind: "model" })
    else
      ActionCable.server.broadcast("room:demo", { text: text, kind: "controller", worker: Process.pid })
    end
    head :no_content
  end

  def report
    report = current_user.reports.create!(title: params.require(:text).to_s.first(100))
    render json: { id: report.id }
  end

  def revoke
    current_user.update!(active: false)
    ActionCable.server.remote_connections.where(current_user: current_user).disconnect(reconnect: false)
    head :no_content
  end

  def logout
    ActionCable.server.remote_connections.where(current_user: current_user).disconnect(reconnect: false)
    reset_session
    head :no_content
  end

  def audit
    render json: { user: current_user.name, events: AuditEvent.where(user_id: current_user.id).group(:event).count }
  end

  private

  def current_user
    @current_user ||= User.find_by(id: session[:user_id])
  end
  helper_method :current_user

  def require_user
    head :unauthorized unless current_user
  end
end
