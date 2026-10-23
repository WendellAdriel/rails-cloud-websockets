class PresenceChannel < ApplicationCable::Channel
  def subscribed
    stream_from "presence:demo"
    User.increment_counter(:presence, current_user.id)
    transmit({ kind: "presence", count: User.where("presence > 0").count })
  end

  def unsubscribed
    User.where(id: current_user.id).where("presence > 0").update_all("presence = presence - 1")
  end
end
