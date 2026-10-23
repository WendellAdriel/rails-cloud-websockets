class BrokerPresenceChannel < ApplicationCable::Channel
  include AnyCable::Rails::Channel::Presence

  def subscribed
    stream_from "broker-presence:demo"
    join_presence(id: current_user.id, info: { name: current_user.name })
  end

  def unsubscribed
    leave_presence(current_user.id)
  end
end
