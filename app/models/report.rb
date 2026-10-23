class Report < ApplicationRecord
  belongs_to :user
  broadcasts_to :user, inserts_by: :prepend
end
