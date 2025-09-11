#!/bin/bash

# Script to update all test files to use setupContractTest and cleanupContractTest

# List of test files that need updating
FILES=(
  "apps/server/tests/contract/system.register.contract.test.ts"
  "apps/server/tests/contract/system.heartbeat.contract.test.ts"
  "apps/server/tests/contract/system.metrics.contract.test.ts"
  "apps/server/tests/contract/system.get_state.contract.test.ts"
  "apps/server/tests/contract/hook.pre_tool.contract.test.ts"
  "apps/server/tests/contract/hook.post_tool.contract.test.ts"
  "apps/server/tests/contract/hook.todo_write.contract.test.ts"
  "apps/server/tests/contract/hook.user_prompt.contract.test.ts"
  "apps/server/tests/contract/task.update.contract.test.ts"
)

for FILE in "${FILES[@]}"; do
  echo "Updating $FILE..."
  
  # Create a temporary file
  TEMP_FILE="${FILE}.tmp"
  
  # Process the file with awk for more precise updates
  awk '
    # Track if we have added the import
    BEGIN { import_added = 0; in_beforeAll = 0; in_afterAll = 0 }
    
    # Add import after registry import
    /import { registry } from "@\/core\/registry";/ {
      print
      if (!import_added) {
        print "import { setupContractTest, cleanupContractTest } from \"../helpers/test-setup\";"
        import_added = 1
      }
      next
    }
    
    # Skip getRedis import lines
    /import { getRedis/ { next }
    /import { .*, getRedis/ { 
      # Extract other imports if present
      gsub(/, getRedis/, "", $0)
      gsub(/getRedis, /, "", $0)
      print
      next
    }
    
    # Update redis type declaration
    /let redis: ReturnType<typeof getRedis>/ {
      gsub(/ReturnType<typeof getRedis>/, "any", $0)
      print
      next
    }
    
    # Handle beforeAll block
    /beforeAll\(async \(\) => \{/ {
      print
      print "\t\tredis = await setupContractTest();"
      in_beforeAll = 1
      next
    }
    
    in_beforeAll {
      # Skip these lines in beforeAll
      if (/redis = getRedis\(\)/) { next }
      if (/\/\/ Initialize registry/) { next }
      if (/await registry\.discover\(\)/) { next }
      
      # End of beforeAll
      if (/^\t\}\);/) {
        print
        in_beforeAll = 0
        next
      }
      
      # Keep other lines in beforeAll
      print
      next
    }
    
    # Handle afterAll block
    /afterAll\(async \(\) => \{/ {
      print
      print "\t\tawait cleanupContractTest();"
      in_afterAll = 1
      next
    }
    
    in_afterAll {
      # Skip everything until closing
      if (/^\t\}\);/) {
        print
        in_afterAll = 0
        next
      }
      next
    }
    
    # Print all other lines
    { print }
  ' "$FILE" > "$TEMP_FILE"
  
  # Replace original file with updated one
  mv "$TEMP_FILE" "$FILE"
done

echo "All test files updated!"