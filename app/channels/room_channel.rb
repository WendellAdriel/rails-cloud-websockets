class RoomChannel < ApplicationCable::Channel
  attr_accessor :messages

  def subscribed
    return reject unless params[:room] == "demo"
    self.messages = 0
    stream_from "room:demo"
  end

  def speak(data)
    self.messages += 1
    ActionCable.server.broadcast("room:demo", { text: data.fetch("text"), kind: "broadcast", count: messages, user: current_user.name, worker: Process.pid })
  end

  def direct(data)
    transmit({ text: data.fetch("text"), kind: "direct", worker: Process.pid })
  end

  def unfollow
    stop_all_streams
  end

  def follow
    stream_from "room:demo"
  end

  def whisper(data)
    ActionCable.server.broadcast("room:demo", { text: data.fetch("text"), kind: "whisper", user: current_user.name })
  end
end
