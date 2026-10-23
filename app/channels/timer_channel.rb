class TimerChannel < ApplicationCable::Channel
  periodically :tick, every: 2.seconds

  def tick
    transmit({ kind: "tick", worker: Process.pid })
  end
end
