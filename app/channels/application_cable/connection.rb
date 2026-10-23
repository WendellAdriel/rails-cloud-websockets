module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user
    before_command :record_command

    def connect
      self.current_user = User.find_by(id: request.session[:user_id], active: true)
      reject_unauthorized_connection unless current_user
      AuditEvent.create!(user_id: current_user.id, event: "connect", worker: Process.pid)
    end

    def disconnect
      AuditEvent.create!(user_id: current_user.id, event: "disconnect", worker: Process.pid) if current_user
    end

    private

    def record_command
      AuditEvent.create!(user_id: current_user.id, event: "command", worker: Process.pid)
    end
  end
end
