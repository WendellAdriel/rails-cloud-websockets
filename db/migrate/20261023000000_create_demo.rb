class CreateDemo < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.string :name, null: false
      t.boolean :active, default: true, null: false
      t.integer :presence, default: 0, null: false
      t.timestamps
    end
    add_index :users, :name, unique: true
    create_table :reports do |t|
      t.references :user, null: false, foreign_key: true
      t.string :title, null: false
      t.timestamps
    end
    create_table :audit_events do |t|
      t.bigint :user_id
      t.string :event, null: false
      t.integer :worker, null: false
      t.timestamps
    end
  end
end
