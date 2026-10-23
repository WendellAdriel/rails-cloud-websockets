class CustomChannel < ApplicationCable::Channel
  def subscribed
    stream_from "custom:demo", coder: ActiveSupport::JSON do |message|
      transmit({ text: message.fetch("text").upcase, kind: "custom" })
      transmit({ text: message.fetch("text").upcase, kind: "custom-copy" }) if params["copies"] == 2
    end
  end
end
