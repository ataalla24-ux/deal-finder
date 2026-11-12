require 'yaml'
require 'json'

root = File.expand_path('..', __dir__)
docs = File.join(root, 'docs')
config = YAML.load_file(File.join(docs, '_config.yml'))
excluded = config.fetch('exclude')
required = %w[deal-admin.html deals-pending-all.json deal-candidates-index.json
  deal-review-feedback.json sent-deal-ids.json meta-instagram-state.json
  meta-instagram-scan-state.json]
raise 'Jekyll exclusions bypassed by .nojekyll' if File.exist?(File.join(docs, '.nojekyll'))
raise 'Missing internal website exclusions' unless (required - excluded).empty?
raise 'App association files must remain public' unless config.fetch('include').include?('.well-known')

public_files = %w[index.html app/index.html pro-test.html deals.json deal-map-locations.json
  deal-of-the-day.json deal-of-the-week.json .well-known/apple-app-site-association
  .well-known/assetlinks.json]
public_files.each do |file|
  raise "Public app resource missing: #{file}" unless File.file?(File.join(docs, file))
  raise "Public app resource excluded: #{file}" if excluded.include?(file)
end

# Existing HTML/JSON/JS/CSS must remain static, not become Liquid templates.
Dir.glob(File.join(docs, '**/*.{html,json,js,css,scss}')).each do |file|
  raise "Unexpected front matter: #{file}" if File.open(file, 'rb') { |f| f.read(4) } == "---\n"
end
Dir.glob(File.join(docs, '**/*.{html,js}')).each do |file|
  relative = file.delete_prefix("#{docs}/")
  next if excluded.include?(relative)
  text = File.read(file)
  required.each do |internal|
    raise "Customer page still consumes internal file: #{relative} -> #{internal}" if text.include?(internal)
  end
end
puts "Pages boundary passed: #{required.length} internal endpoints excluded; customer pages and app associations preserved."
