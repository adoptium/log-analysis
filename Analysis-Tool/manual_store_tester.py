from log_store import EventStore, ingest_all

#manual tester for log_store, also shows how to use EventStore
#check the code for all the usable functions, these are just a few

store = EventStore("jenkins_logs.duckdb")
print(f"\nDistinct Files: {store.distinct_files()}\n")
print(f"Level Counts: {store.level_counts()}\n")
print(f"Top 10 Templates: {store.top_templates(10)}\n")
print(f"Tag Summary: {store.tag_summary()}\n")
#this will literally clog your screen
print(f"6 Minutes Time Filter: {store.time_filter(hours = .1)}")

#in-process temporary database
second_store = EventStore(":memory:")
#note that the .bin file needs to be preserved
#technically this is wrong because that .bin was created from only 2 files 
#use a temp .bin along the temp memory if you want
ingest_all("sample-logs/jenkins/", second_store, persistence_path="drain3_state.bin")
print(f"\n {second_store.level_counts()} \n")
