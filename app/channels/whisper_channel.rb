class WhisperChannel < ApplicationCable::Channel
  def subscribed
    stream_from "whisper:demo", whisper: true
  end
end
